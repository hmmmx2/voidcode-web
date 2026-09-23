/**
 * Ask GitHub, at BUILD time, whether there is anything to download — and write the answer down.
 *
 * ── WHY THIS EXISTS, WHICH IS A DEFECT A VISITOR FOUND ───────────────────────────────────────────
 *
 * `DownloadSection` resolved everything at view time by reading `api.github.com` from the visitor's
 * own browser. That has a hard limit of 60 anonymous requests an hour PER IP, so one office or
 * campus NAT exhausts it for everyone behind it, and the page then offered nothing at all.
 *
 * The fix for that was a version-less asset URL, which needs no API call. The fix for the fix is
 * this file, because the first version could not tell two states apart:
 *
 *   * GitHub SAID there is no release      -> offering a link is wrong; it 404s.
 *   * GitHub could not be ASKED            -> a release may well be there.
 *
 * When both are true at once — rate-limited AND nothing published, which is exactly the state this
 * site launched in — the page offered a download that returned `404 Not Found`. Someone clicked it.
 * A comment three lines above the code promised it would never do that.
 *
 * ── WHAT THIS CHANGES ───────────────────────────────────────────────────────────────────────────
 *
 * The question moves from the visitor's browser to the build. A build runs once, from Vercel's own
 * address, and its answer is the same for every visitor — so the page no longer has to guess from a
 * failed request whether a release exists. The client fetch stays, demoted to what it should always
 * have been: an enhancement that notices a release NEWER than the one this build saw.
 *
 * ── THREE STATES, AND THE THIRD IS THE POINT ────────────────────────────────────────────────────
 *
 *   published   a release exists; its tag, date and per-asset sizes are baked in. A rate-limited
 *               visitor gets a real download from the version-less URL.
 *   none        GitHub answered and there is no release. The page says so and draws no button.
 *   unknown     the build could not ask — no repository configured, offline, rate-limited, 5xx.
 *               The page offers the repository's `/releases` page, which answers 200 whether or not
 *               anything is published, instead of a file that may not exist.
 *
 * `unknown` is why this script NEVER FAILS A BUILD. A deploy that cannot reach GitHub must still
 * ship; what it must not do is claim to know something. The alternative — exiting non-zero — would
 * make every deploy depend on a third party being reachable, to protect against a state the page
 * already handles.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
/**
 * Overridable for the same reason as `API_BASE`: so the state check can exercise this script
 * without touching the artefact a build depends on.
 *
 * The first version of that check wrote to this real path and deleted it on the way out — and
 * since `verify` runs AFTER `resolve:release` in `prebuild`, it removed the file the build was
 * about to import. `next build` then failed with two unexplained Turbopack errors. A test that
 * cleans up a production artefact is worse than one that leaves a mess.
 */
const TARGET = process.env.VOIDCODE_RELEASE_OUT ?? join(root, "src", "generated", "release.json");

/**
 * Overridable ONLY so the three branches below can be exercised without waiting on a real release.
 *
 * All three matter and two of them are the dangerous ones — `none` must draw no button and
 * `unknown` must not name a file — so shipping them unproven was not acceptable, and GitHub's
 * anonymous limit made proving them against the real API a matter of luck. `npm run
 * verify:release-states` points this at a local stub and asserts each outcome.
 *
 * Not a production knob: a deploy that sets it is asking a different server whether this product
 * has a release, which is why it is not documented in `.env.example` and why the default is the
 * real address rather than something a missing value could silently become.
 */
const API_BASE = process.env.VOIDCODE_RELEASE_API_BASE ?? "https://api.github.com";

/**
 * ONE PUBLIC REPOSITORY, HARDCODED, matching DownloadSection.tsx. VoidCode ships every installer
 * from `hmmmx2/voidcode`, so both platforms resolve the same release. This was two env-configured
 * repositories until the installers were consolidated into one; the indirection is gone because a
 * misconfigured Vercel value silently blanked the download page.
 */
const REPO = "hmmmx2/voidcode";
const REPOS = { mac: REPO, win: REPO };

/**
 * The version-less names `release.yml`'s `distribute` job publishes.
 *
 * DUPLICATED FROM `DownloadSection.tsx` ON PURPOSE, and the duplication is the check. This script
 * asserts each name is actually present in the release it found, so a rename in the desktop
 * repository's workflow turns into a BUILD-TIME failure here rather than a 404 a visitor discovers.
 * Two lists that must agree, with something that compares them — which is the difference between a
 * contract and a coincidence.
 */
const STABLE = {
  mac: ["VoidCode-macOS-AppleSilicon.dmg", "VoidCode-macOS-Intel.dmg"],
  win: ["VoidCode-Windows-x64-Setup.exe", "VoidCode-Windows-ARM64-Setup.exe"],
};

async function resolveOne(os) {
  const repo = REPOS[os];
  if (repo === "") {
    return { state: "unknown", why: `NEXT_PUBLIC_RELEASES_REPO_${os.toUpperCase()} is not set` };
  }

  let response;
  try {
    response = await fetch(`${API_BASE}/repos/${repo}/releases/latest`, {
      headers: {
        accept: "application/vnd.github+json",
        // Vercel builds get no token by default. If one is present it raises the limit from 60 an
        // hour to 5,000 and changes nothing else, so it is used when offered and never required.
        ...(process.env.GITHUB_TOKEN ? { authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
      },
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    return { state: "unknown", repo, why: `could not reach GitHub: ${String(error)}` };
  }

  if (response.status === 404) {
    // ANSWERED. This is the state that must not be guessed at: there is no release, so no link to
    // an asset can work, and the page draws no button.
    return { state: "none", repo, why: "GitHub reports no published release" };
  }
  if (!response.ok) {
    return { state: "unknown", repo, why: `GitHub answered ${response.status}` };
  }

  let release;
  try {
    release = await response.json();
  } catch (error) {
    return { state: "unknown", repo, why: `unreadable release body: ${String(error)}` };
  }

  const assets = Array.isArray(release.assets) ? release.assets : [];
  const sizes = {};
  const missing = [];
  for (const name of STABLE[os]) {
    const asset = assets.find((candidate) => candidate?.name === name);
    if (asset === undefined) missing.push(name);
    else sizes[name] = typeof asset.size === "number" ? asset.size : null;
  }

  if (missing.length > 0) {
    // The release exists and does not carry the names the page links. Loud, because the two lists
    // have drifted and the symptom otherwise is a visitor's 404.
    console.error(`  ${os}: release ${String(release.tag_name)} is missing ${missing.join(", ")}`);
    console.error(
      "  These names come from `release.yml`'s `distribute` job. If they changed there, change"
    );
    console.error("  `STABLE` here and `stableName` in DownloadSection.tsx together.");
    return {
      state: "unknown",
      repo,
      why: `the latest release does not carry ${missing.join(", ")}`,
    };
  }

  return {
    state: "published",
    repo,
    tag: typeof release.tag_name === "string" ? release.tag_name : null,
    publishedAt: typeof release.published_at === "string" ? release.published_at : null,
    sizes,
  };
}

const resolved = {
  // Stamped so a stale bundle is legible rather than mysterious. Not read by the page.
  resolvedAt: new Date().toISOString(),
  mac: await resolveOne("mac"),
  win: await resolveOne("win"),
};

mkdirSync(dirname(TARGET), { recursive: true });
writeFileSync(TARGET, `${JSON.stringify(resolved, null, 2)}\n`, "utf8");

for (const os of ["mac", "win"]) {
  const entry = resolved[os];
  const detail = entry.state === "published" ? `${entry.tag}` : entry.why;
  console.log(`Release resolved: ${os} -> ${entry.state} (${detail})`);
}
