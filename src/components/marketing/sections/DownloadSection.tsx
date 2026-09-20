"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Container,
  Eyebrow,
  Lead,
  MonoLabel,
  Section,
  SectionHeading,
} from "@/components/marketing/primitives/SectionShell";
import { Pill } from "@/components/ui/Pill";
import { Reveal } from "@/components/motion/Reveal";

/**
 * Where a visitor actually gets the application.
 *
 * THE LAST SECTION ON PURPOSE. Everything above it argues that the product is worth having; this is
 * the one place that hands it over. It is built from the page's own primitives — `Section`,
 * `Container`, `SectionHeading`, `Lead`, `Eyebrow`, `MonoLabel`, `Pill`, `Reveal` — so it reads as
 * the end of this page rather than a download page bolted onto one.
 *
 * TWO PLATFORM PANELS, NOT A TABLE. A table is the right shape for "every file this release
 * carries" and the wrong shape for the decision a visitor is actually making, which is one choice
 * between two operating systems and, on a Mac, between two processors. So each platform gets a
 * panel with its own primary button, its files listed underneath with size and checksum, and the
 * install step that platform's own security prompt will require. Nobody has to read a row they are
 * not on.
 *
 * A CLIENT COMPONENT, AND THE ONLY ONE IN THE PAGE'S TAIL. It has to be: the file list comes from
 * the release feed at view time, and the primary button depends on the visitor's own platform.
 * Nothing above it is affected — the hero's `<h1>` is still server-rendered text with nothing in
 * front of it, which is what keeps the largest paint fast.
 *
 * WHY THE LINKS ARE NOT COMMITTED TO THIS REPOSITORY
 *
 * A hand-maintained table of versions, sizes and checksums is a second source of truth for the one
 * thing here that must not be wrong, edited by hand right after a release by someone who has just
 * spent an hour on a release. A stale checksum beside a fresh installer is worse than no checksum.
 * The release list is the record; this asks it.
 *
 * WHAT IT DOES WHEN IT CANNOT ASK
 *
 * No repository configured, offline, or no release published yet: it says which of those happened
 * and, where there is one, links to the releases page.
 *
 * RATE-LIMITED IS THE CASE THAT CHANGED, and it changed because the honest message was still a dead
 * end. GitHub allows 60 anonymous API requests an hour PER IP, so one office or campus NAT exhausts
 * it for everyone behind it — and this section said "No download yet. GitHub is rate-limiting this
 * network, so the file list could not be read." Every word true, and the visitor could not reach a
 * release that was sitting there.
 *
 * So the feed is no longer what the download DEPENDS on. `release.yml`'s `distribute` job publishes
 * a version-less copy of every installer, and `https://github.com/<repo>/releases/latest/download/
 * <name>` is a redirect rather than an API call, subject to no limit. When the feed cannot be read,
 * that address is offered instead — every architecture, not just the likeliest — and the page says
 * which detail is missing rather than which button is disabled.
 *
 * PRECEDENCE, because it is the part that is easy to get wrong: when the feed DID answer, it is
 * believed. A release that genuinely carries no installer for a platform still says so. The stable
 * address is used only where the alternative is nothing at all — otherwise a page could offer a
 * link that 404s and call it an improvement.
 *
 * It still never draws a primary action that leads nowhere. What it no longer does is disable one
 * because a shared network spent its API budget.
 */

/**
 * ONE REPOSITORY PER PLATFORM, and that is a behaviour change rather than plumbing.
 *
 * The installers are published to two separate repositories -- one for macOS, one for Windows --
 * because they are what a person downloads and nothing else needs to be in those repositories at
 * all. This section used to read a single `NEXT_PUBLIC_RELEASES_REPO`.
 *
 * WHAT THAT FIXES. With one feed, a single 403 blanked the whole section: GitHub rate-limits
 * anonymous requests at 60 an hour PER IP, which a shared office network exhausts easily, and the
 * failure took both platforms' download buttons with it. Two feeds are fetched independently and
 * held in independent state, so a rate-limited macOS feed no longer hides the Windows installer.
 *
 * The old single-repository variable is DELETED rather than left as a fallback. A fallback would be
 * read by a deployment that set only the old name, which would then serve Windows visitors macOS
 * disk images -- and it would look configured.
 */
const REPOS = {
  mac: (process.env.NEXT_PUBLIC_RELEASES_REPO_MAC ?? "").trim(),
  win: (process.env.NEXT_PUBLIC_RELEASES_REPO_WIN ?? "").trim(),
} as const;

/** Separate keys, so one platform's cached feed is never served as the other's. */
const CACHE_KEY = { mac: "voidcode:release:mac", win: "voidcode:release:win" } as const;
const CACHE_MS = 10 * 60 * 1000;

interface Kind {
  os: "mac" | "win";
  arch: "arm64" | "x64";
  /** What a person chooses between, in their words rather than the build's. */
  label: string;
  hint: string;
  /** The installer's extension, shown before a release exists so the row still says something. */
  file: string;
  pattern: RegExp;
  /**
   * The VERSION-LESS copy of this installer, which `release.yml`'s `distribute` job uploads
   * alongside the versioned one. It is the whole reason a download can be offered without an
   * API call — see `stableUrl` below.
   */
  stableName: string;
  /**
   * Offered as the primary download when the API cannot be read and the chip is unknowable.
   * Apple silicon for Mac and 64-bit for Windows: the overwhelming majority of each, and the
   * other file stays one click away in the list underneath.
   */
  likeliest?: true;
}

/**
 * The files a release carries.
 *
 * Matched on the asset name from `desktop/electron-builder.yml`'s
 * `${productName}-${version}-${os}-${arch}.${ext}` — so `VoidCode-0.1.0-mac-arm64.dmg`.
 *
 * `stableName` is the same file under a name that does not move between releases, so
 * `https://github.com/<repo>/releases/latest/download/<stableName>` is a permanent address for
 * "the newest installer". THE NAMES MUST MATCH `release.yml`'s `distribute` job exactly; it
 * copies each versioned artefact to these names before publishing, and a typo on either side is
 * a download button that 404s.
 */
const KINDS: Kind[] = [
  {
    os: "mac",
    arch: "arm64",
    label: "Apple silicon",
    hint: "M1, M2, M3, M4",
    file: ".dmg",
    pattern: /-mac-arm64\.dmg$/,
    stableName: "VoidCode-macOS-AppleSilicon.dmg",
    likeliest: true,
  },
  {
    os: "mac",
    arch: "x64",
    label: "Intel",
    hint: "pre-2020 Macs",
    file: ".dmg",
    pattern: /-mac-x64\.dmg$/,
    stableName: "VoidCode-macOS-Intel.dmg",
  },
  {
    os: "win",
    arch: "x64",
    label: "64-bit",
    hint: "most PCs",
    file: ".exe installer",
    pattern: /-win-x64\.exe$/,
    stableName: "VoidCode-Windows-x64-Setup.exe",
    likeliest: true,
  },
  {
    os: "win",
    arch: "arm64",
    label: "ARM",
    hint: "Snapdragon, Surface Pro X",
    file: ".exe installer",
    pattern: /-win-arm64\.exe$/,
    stableName: "VoidCode-Windows-ARM64-Setup.exe",
  },
];

const PLATFORMS = [
  {
    os: "mac" as const,
    title: "macOS",
    what: "A disk image you drag into Applications. Apple silicon and Intel are separate files.",
    /**
     * EVERY STEP FROM THE CLICK TO A RUNNING APP, in order, with nothing assumed.
     *
     * These began at "open the .dmg", which skipped the two places people actually stop: finding
     * the file after the browser saves it, and the refusal on first launch. An unsigned app does
     * not present as "unsigned" — macOS says the developer "cannot be verified", which reads as a
     * warning about the software rather than a step to take. Anyone who does not know the way past
     * it has downloaded 200 MB and reached a dead end.
     */
    gate: [
      "Press the download button. The file is about 200 MB and lands in your Downloads folder.",
      "Double-click VoidCode-macOS-AppleSilicon.dmg, then drag the VoidCode icon onto Applications.",
      "Open Applications and double-click VoidCode. macOS refuses the first launch and says the developer cannot be verified — this is expected, because the app is not signed with a paid Apple certificate.",
      "Open System Settings › Privacy & Security, scroll to the message about VoidCode, and choose Open Anyway. Confirm once more when asked.",
      "It opens. Nothing else to install — Python and every problem ship inside the app, and it works with no network.",
    ],
    verify: "shasum -a 256 VoidCode-*.dmg",
    /** How to tell which file you need, when the browser cannot. */
    which: "Apple menu › About This Mac. “Chip: Apple M…” is Apple silicon; “Processor: Intel” is the Intel build.",
  },
  {
    os: "win" as const,
    title: "Windows",
    what: "An installer that sets the app up for your user account. No administrator rights needed.",
    gate: [
      "Press the download button. The file is about 150 MB and lands in your Downloads folder.",
      "Double-click VoidCode-Windows-x64-Setup.exe. Windows shows a blue “Windows protected your PC” box — this is expected, because the installer is not signed with a paid certificate.",
      "Choose More info, then Run anyway. The Run anyway button only appears after More info, which is the step people miss.",
      "Follow the installer. It installs for your account only, so no administrator password is needed.",
      "It opens. Nothing else to install — Python and every problem ship inside the app, and it works with no network.",
    ],
    verify: "Get-FileHash VoidCode-*.exe -Algorithm SHA256",
    which: "Settings › System › About, under “System type”. ARM only applies to Snapdragon and Surface Pro X machines.",
  },
];

interface Asset {
  name: string;
  size: number;
  browser_download_url: string;
  digest?: string | null;
}

interface Release {
  tag_name?: string;
  published_at?: string;
  assets?: Asset[];
}

/** One platform's feed. The two are held separately so one failing cannot blank the other. */
type Feed =
  | { status: "loading" }
  /**
   * `answered` separates the two cases that look identical and must not be treated alike.
   *
   * TRUE means GitHub replied and said there is nothing — a 404 for a repository with no release,
   * or a release carrying no installer for this platform. Believe it: there is no file, and any
   * link would 404.
   *
   * FALSE means the question could not be asked — rate-limited, offline, or an error. A release may
   * well be sitting there, so the version-less address is offered instead of a dead button.
   *
   * Without this distinction the fallback would have offered a download before the first release
   * existed, which is the precise failure the fallback was added to avoid, pointed the other way.
   */
  | { status: "unavailable"; reason: string; answered: boolean }
  | { status: "ready"; release: Release; found: Map<string, Asset> };

type State = { mac: Feed; win: Feed };

type Os = keyof State;

const key = (kind: Kind): string => `${kind.os}-${kind.arch}`;

/** A placeholder is not a repository, and refusing anything else keeps a pasted URL out of the path. */
function repoName(os: Os): string | null {
  const value = REPOS[os];
  return /^[\w.-]+\/[\w.-]+$/.test(value) && value !== "OWNER/REPO" ? value : null;
}

/** Bytes as a person would say them. Two significant figures is all a download size deserves. */
function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  const mb = bytes / 1024 / 1024;
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`;
}

/**
 * The SHA-256 of an asset, when the feed gives one.
 *
 * `digest` arrives as `sha256:<hex>` on releases published since GitHub added the field, and is
 * absent on older ones — hence the empty string rather than a guess.
 */
function digestOf(asset: Asset): string {
  const match = /^sha256:([0-9a-f]{64})$/.exec(asset.digest ?? "");
  return match === null ? "" : match[1];
}

/**
 * Which platform to put first.
 *
 * Client hints where they exist, because they are the only way to tell an ARM Windows PC from an
 * x64 one. On macOS the answer is deliberately NOT taken from the user agent: Safari and Firefox
 * report "Intel Mac OS X 10_15_7" on every Mac, Apple silicon included, so the UA can only say "a
 * Mac". Apple silicon is the default there — and both files stay listed, with the note on how to
 * check, because guessing wrong costs someone a download that will not open.
 */
async function detect(): Promise<string | null> {
  const ua = navigator.userAgent;
  const os = /Windows|Win32|Win64/.test(ua) ? "win" : /Mac/.test(ua) ? "mac" : null;
  if (os === null) return null; // Linux, Android, iOS: no guess, both panels stay equal.

  let arch = os === "mac" ? "arm64" : "x64";
  const data = (
    navigator as Navigator & {
      userAgentData?: { getHighEntropyValues(hints: string[]): Promise<Record<string, string>> };
    }
  ).userAgentData;

  if (data !== undefined) {
    try {
      const hints = await data.getHighEntropyValues(["architecture", "bitness"]);
      if (hints.architecture === "arm") arch = "arm64";
      else if (hints.architecture === "x86" && hints.bitness === "32") return null;
    } catch {
      /* Hints are a courtesy; the default stands. */
    }
  }
  return `${os}-${arch}`;
}

function cached(os: Os, repo: string): Release | null {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY[os]);
    if (raw === null) return null;
    const entry = JSON.parse(raw) as { key: string; at: number; release: Release };
    if (entry.key !== repo || Date.now() - entry.at > CACHE_MS) return null;
    return entry.release;
  } catch {
    // Private windows and blocked site data both throw here. No cache is fine.
    return null;
  }
}

function remember(os: Os, repo: string, release: Release): void {
  try {
    sessionStorage.setItem(CACHE_KEY[os], JSON.stringify({ key: repo, at: Date.now(), release }));
  } catch {
    /* see cached() */
  }
}

export function DownloadSection() {
  const [state, setState] = useState<State>({
    mac: { status: "loading" },
    win: { status: "loading" },
  });
  const [copied, setCopied] = useState<string | null>(null);
  /** The visitor's platform, resolved independently of the release feed — it is known offline. */
  const [detected, setDetected] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void detect().then((platform) => {
      if (!cancelled) setDetected(platform);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    /** One platform's feed, resolved to a `Feed` rather than thrown. */
    const loadOne = async (os: Os): Promise<Feed> => {
      const repo = repoName(os);
      if (repo === null) {
        return {
          status: "unavailable",
          reason:
            "The first release has not been published yet, so there is nothing to download here.",
          // No repository configured. Nothing can be constructed, authoritative or not.
          answered: true,
        };
      }

      let release = cached(os, repo);
      if (release === null) {
        try {
          const response = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
            headers: { accept: "application/vnd.github+json" },
          });
          if (response.status === 404) {
            // GitHub ANSWERED: this repository has no published release. Authoritative.
            return {
              status: "unavailable",
              reason: "No release has been published yet.",
              answered: true,
            };
          }
          if (response.status === 403 || response.status === 429) {
            return {
              status: "unavailable",
              reason: "GitHub is rate-limiting this network, so the file list could not be read.",
              // Could not ask. A release may be there; offer the version-less address.
              answered: false,
            };
          }
          if (!response.ok) {
            return {
              status: "unavailable",
              reason: "The release list could not be read just now.",
              answered: false,
            };
          }
          release = (await response.json()) as Release;
          remember(os, repo, release);
        } catch {
          return {
            status: "unavailable",
            reason: "Could not reach GitHub to read the release list.",
            answered: false,
          };
        }
      }

      const assets = release.assets ?? [];
      const found = new Map<string, Asset>();
      // THIS PLATFORM'S KINDS ONLY. A macOS feed carrying a stray .exe is not a Windows download,
      // and matching every pattern against every feed would draw it as one.
      for (const kind of KINDS.filter((candidate) => candidate.os === os)) {
        const asset = assets.find((candidate) => kind.pattern.test(candidate.name ?? ""));
        if (asset !== undefined) found.set(key(kind), asset);
      }
      if (found.size === 0) {
        return {
          status: "unavailable",
          reason: "The latest release does not carry an installer for this platform.",
          // GitHub answered and the file is not in the release. Authoritative — a version-less
          // link would point at the same absent file.
          answered: true,
        };
      }
      return { status: "ready", release, found };
    };

    /*
     * `allSettled`, and the choice matters.
     *
     * `Promise.all` rejects on the first failure and would discard a perfectly good feed because
     * the other one was rate-limited — which is the exact defect the two-repository split exists to
     * fix, reintroduced one layer up. `loadOne` already resolves every refusal to a `Feed`, so
     * nothing here should reject; `allSettled` is what makes that a guarantee rather than an
     * assumption about code somebody may edit later.
     */
    void Promise.allSettled([loadOne("mac"), loadOne("win")]).then(([mac, win]) => {
      if (cancelled) return;
      const settle = (result: PromiseSettledResult<Feed>): Feed =>
        result.status === "fulfilled"
          ? result.value
          : {
              status: "unavailable",
              reason: "The release list could not be read just now.",
              // A rejection here means `loadOne` threw rather than resolving a refusal, so nothing
              // was learned about whether a release exists. Not authoritative.
              answered: false,
            };
      setState({ mac: settle(mac), win: settle(win) });
    });

    return () => {
      cancelled = true;
    };
  }, []);

  const copy = useCallback((value: string, id: string) => {
    void navigator.clipboard?.writeText(value).then(
      () => {
        setCopied(id);
        window.setTimeout(() => setCopied((current) => (current === id ? null : current)), 1600);
      },
      () => {
        /* Clipboard denied. The checksum is selectable text; nothing else to do. */
      }
    );
  }, []);

  const tagOf = (feed: Feed): string | null =>
    feed.status === "ready" ? (feed.release.tag_name ?? "").replace(/^v/, "") || null : null;

  /**
   * ONE VERSION LINE, AND ONLY WHEN BOTH REPOSITORIES AGREE.
   *
   * The two platforms are released from two repositories and can legitimately be on different tags
   * for a while — one publishes before the other, or a macOS build is re-cut. A single number in
   * the section head would then be a claim about downloads that do not carry it, and the visitor
   * has no way to tell which half it describes. Each panel already shows its own version, so the
   * honest answer when they disagree is to say nothing here rather than pick a winner.
   */
  const macTag = tagOf(state.mac);
  const winTag = tagOf(state.win);
  const version = macTag !== null && macTag === winTag ? macTag : null;

  const publishedOf = (feed: Feed): string | null =>
    feed.status === "ready" && feed.release.published_at !== undefined
      ? new Date(feed.release.published_at).toLocaleDateString(undefined, {
          year: "numeric",
          month: "short",
          day: "numeric",
        })
      : null;
  // The same rule: a date is shown only where a single version is.
  const published = version === null ? null : publishedOf(state.mac);

  return (
    <Section id="download">
      <Container>
        <Reveal>
          {/* Heading left, metadata right — the arrangement every section head on this page uses,
              with the release's identity where a data sheet would put it. */}
          <div className="flex flex-wrap items-end justify-between gap-6">
            <div>
              <Eyebrow>Download</Eyebrow>
              <SectionHeading className="max-w-none">
                Install it on your own machine.
              </SectionHeading>
            </div>
            <dl className="flex items-center gap-8">
              <div>
                <dt>
                  <MonoLabel>Version</MonoLabel>
                </dt>
                <dd className="mt-1 text-sm font-light tracking-tight text-ink">
                  {version ?? "—"}
                </dd>
              </div>
              <div>
                <dt>
                  <MonoLabel>Published</MonoLabel>
                </dt>
                <dd className="mt-1 text-sm font-light tracking-tight text-ink">
                  {published ?? "—"}
                </dd>
              </div>
              <div>
                <dt>
                  <MonoLabel>Licence</MonoLabel>
                </dt>
                <dd className="mt-1 text-sm font-light tracking-tight text-ink">Apache-2.0</dd>
              </div>
            </dl>
          </div>

          {/* FULL WIDTH, to the container's own margins. `Lead` and `SectionHeading` cap their
              measure for a paragraph that shares a row with something else; these two have the row
              to themselves, so the cap only left empty space to the right of every line. The
              container (`Container`) is what holds the gutter now — nothing here sets its own. */}
          <Lead className="max-w-none">
            The editor, the problems and the grader all run locally. An account is optional — it is
            needed only for the hosted VoidCode model and the credits that pay for it.
          </Lead>

          {/*
            THE PANELS ALWAYS RENDER. Which file a visitor needs, and what their operating system
            will do when they run an unsigned installer, are facts about the platform — not about
            whether a release happens to be published, or whether GitHub answered. Only the links,
            sizes and checksums come from the release feed, so only those parts change state. The
            first version hid all of it behind the feed, which meant the section said nothing at
            all until a release existed.
          */}
          <div className="mt-14 grid gap-6 lg:grid-cols-2">
            {PLATFORMS.map((platform) => {
              const kinds = KINDS.filter((kind) => kind.os === platform.os);
              const mine = detected !== null && detected.startsWith(`${platform.os}-`);
              const feed = state[platform.os];
              const found = feed.status === "ready" ? feed.found : new Map<string, Asset>();
              const ownVersion = tagOf(feed);
              const releasesUrl =
                repoName(platform.os) === null
                  ? null
                  : `https://github.com/${repoName(platform.os)}/releases`;
              const available = kinds.filter((kind) => found.has(key(kind)));
              const primaryKind =
                available.find((kind) => key(kind) === detected) ?? available[0] ?? null;
              const primary = primaryKind === null ? undefined : found.get(key(primaryKind));

              /**
               * A download that does not need the API to have answered.
               *
               * WHY THIS EXISTS. The feed is `api.github.com` read from the VISITOR'S browser, and
               * unauthenticated requests there are limited to 60 an hour PER IP. One office or
               * campus NAT therefore exhausts it for everyone behind it, and the page said
               * "No download yet — GitHub is rate-limiting this network, so the file list could not
               * be read." That sentence was true and the conclusion was wrong: the release was
               * there, and the visitor had no way to reach it.
               *
               * `releases/latest/download/<name>` is served by a redirect, not by the API, and is
               * subject to no such limit. The versioned artefact name changes every release, so
               * `distribute` uploads a copy under a fixed name and this links that.
               *
               * PRECEDENCE, AND IT MATTERS: when the API answered, believe it — a release that
               * genuinely carries no installer must still say so rather than offering a link that
               * 404s. The stable URL is used only where the alternative is nothing at all.
               */
              const fallbackKind =
                kinds.find((kind) => key(kind) === detected && kind.likeliest === true) ??
                kinds.find((kind) => kind.likeliest === true) ??
                kinds[0] ??
                null;
              const stableUrl =
                repoName(platform.os) === null || fallbackKind === null
                  ? null
                  : `https://github.com/${repoName(platform.os)}/releases/latest/download/${fallbackKind.stableName}`;
              // ONLY when GitHub could not be asked. When it answered that there is no release,
              // there is no file, and a link would 404 — see `answered` on the Feed type.
              const offerStable =
                feed.status === "unavailable" && feed.answered === false && stableUrl !== null;

              return (
                <div
                  key={platform.os}
                  className={[
                    "flex flex-col rounded-cta border bg-void-1 p-8 lg:p-10",
                    // The detected platform is emphasised by its border, not by colour or size:
                    // the other panel must stay a first-class choice for anyone the guess missed.
                    mine ? "border-line-strong" : "border-line",
                  ].join(" ")}
                >
                  <div className="flex items-baseline justify-between gap-4">
                    <h3 className="text-xl font-light tracking-tight text-ink">{platform.title}</h3>
                    {mine ? <MonoLabel>Your system</MonoLabel> : null}
                  </div>

                  <p className="mt-4 text-sm leading-relaxed text-ink-2">{platform.what}</p>

                  {/* The download itself: a button when there is a file, and an honest sentence
                      when there is not. Never a button that leads nowhere. */}
                  <div className="mt-7">
                    {primary !== undefined && primaryKind !== null ? (
                      <>
                        <Pill href={primary.browser_download_url} variant="solid" size="lg">
                          Download for {platform.title}
                        </Pill>
                        <p className="mt-3 text-sm text-ink-3">
                          {primaryKind.label} · {formatSize(primary.size)} · {primaryKind.hint}
                        </p>
                      </>
                    ) : offerStable && stableUrl !== null && fallbackKind !== null ? (
                      <>
                        <Pill href={stableUrl} variant="solid" size="lg">
                          Download for {platform.title}
                        </Pill>
                        <p className="mt-3 max-w-[44ch] text-sm text-ink-3">
                          {fallbackKind.label} · {fallbackKind.hint}. This link always points at the
                          newest release. The version and file size could not be shown because{" "}
                          {feed.reason.replace(/^GitHub is /, "GitHub is currently ")}
                        </p>
                      </>
                    ) : (
                      <>
                        <Pill href="#download" variant="outline" size="lg" aria-disabled="true">
                          {feed.status === "loading" ? "Checking for a release…" : "No download yet"}
                        </Pill>
                        <p className="mt-3 max-w-[40ch] text-sm text-ink-3">
                          {feed.status === "loading"
                            ? "Reading the latest release…"
                            : feed.status === "unavailable"
                              ? feed.reason
                              : `The latest release carries no ${platform.title} installer.`}
                        </p>
                      </>
                    )}
                  </div>

                  {/* Every file this platform gets, so the choice is visible whether or not the
                      feed answered: a size where one is known, and the architecture either way. */}
                  <ul className="mt-6 space-y-2 border-t border-line pt-6">
                    {kinds.map((kind) => {
                      const asset = found.get(key(kind));
                      return (
                        <li key={kind.arch} className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                          {/* Linked when the feed named the file, and ALSO when the feed could not
                              be read at all — the stable address works either way, and a visitor on
                              a rate-limited network needs the other architecture reachable too, not
                              just the one on the button above. Left as plain text only where the
                              feed answered and this file genuinely is not in the release. */}
                          {asset === undefined ? (
                            offerStable && repoName(platform.os) !== null ? (
                              <a
                                href={`https://github.com/${repoName(platform.os)}/releases/latest/download/${kind.stableName}`}
                                className="text-sm text-ink-2 underline decoration-line-strong underline-offset-4 transition-colors hover:text-ink hover:decoration-ink"
                              >
                                {kind.label}
                              </a>
                            ) : (
                              <span className="text-sm text-ink-3">{kind.label}</span>
                            )
                          ) : (
                            <a
                              href={asset.browser_download_url}
                              className="text-sm text-ink-2 underline decoration-line-strong underline-offset-4 transition-colors hover:text-ink hover:decoration-ink"
                            >
                              {kind.label}
                            </a>
                          )}
                          <MonoLabel>
                            {asset === undefined ? kind.file : formatSize(asset.size)}
                          </MonoLabel>
                          <span className="text-xs text-ink-3">{kind.hint}</span>
                        </li>
                      );
                    })}
                  </ul>

                  <p className="mt-6 text-xs leading-relaxed text-ink-3">{platform.which}</p>

                  {/* The install steps, numbered. Every visitor on an unsigned build meets their
                      platform's security prompt, and a step list is read where a paragraph is
                      skipped. */}
                  <ol className="mt-8 space-y-3 border-t border-line pt-7">
                    {platform.gate.map((step, index) => (
                      <li key={step} className="flex gap-3 text-sm leading-relaxed text-ink-2">
                        <MonoLabel className="mt-0.5 shrink-0 text-ink-3">
                          {String(index + 1).padStart(2, "0")}
                        </MonoLabel>
                        <span>{step}</span>
                      </li>
                    ))}
                  </ol>

                  {/* Verifying is instructional whether or not a checksum is on the page yet, so
                      the command stays; the digests appear when the release carries them. */}
                  <div className="mt-8 border-t border-line pt-7">
                    <MonoLabel>Verify what you downloaded</MonoLabel>
                    <pre className="mt-3 overflow-x-auto rounded-lg border border-line bg-void-2 px-3 py-2 font-mono text-[11px] leading-relaxed text-ink-2">
                      {platform.verify}
                    </pre>
                    {available.length > 0 ? (
                      <ul className="mt-4 space-y-3">
                        {available.map((kind) => {
                          const asset = found.get(key(kind))!;
                          const hash = digestOf(asset);
                          const id = key(kind);
                          return (
                            <li key={id}>
                              <div className="flex items-baseline justify-between gap-3">
                                <MonoLabel>SHA-256 · {kind.label}</MonoLabel>
                                {hash === "" ? null : (
                                  <button
                                    type="button"
                                    onClick={() => copy(hash, id)}
                                    className="rounded text-[11px] text-ink-3 underline decoration-line-strong underline-offset-4 transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink"
                                  >
                                    {copied === id ? "Copied" : "Copy"}
                                  </button>
                                )}
                              </div>
                              <p className="mt-1 break-all font-mono text-[11px] leading-relaxed text-ink-3">
                                {hash === "" ? "not published for this file" : hash}
                              </p>
                            </li>
                          );
                        })}
                      </ul>
                    ) : (
                      <p className="mt-3 text-xs leading-relaxed text-ink-3">
                        {ownVersion !== null ? `Version ${ownVersion}. ` : ""}Each file&apos;s
                        SHA-256 is listed here once a release is published. Compare
                        it with the command above before installing.
                      </p>
                    )}
                  </div>

                  {/* This platform's own release history, beside this platform's own files. One
                      link per panel rather than one for the section, because the two platforms are
                      published from two repositories and may be on different versions. */}
                  {releasesUrl === null ? null : (
                    <p className="mt-6 text-xs text-ink-3">
                      Older {platform.title} versions are on{" "}
                      <a
                        href={releasesUrl}
                        className="text-ink-2 underline decoration-line-strong underline-offset-4 transition-colors hover:text-ink hover:decoration-ink"
                      >
                        the releases page
                      </a>
                      .
                    </p>
                  )}
                </div>
              );
            })}
          </div>
          {/*
            THE LINUX SENTENCE WAS DELETED, NOT MOVED, and that is a correction rather than tidying.
            It read "Linux builds (AppImage and .deb), older versions and the source are on the
            releases page" and pointed at the one repository this section used to read. The
            installers now come from two repositories that carry installers and nothing else — no
            Linux build, no source. Left as it was, the sentence would send a Linux visitor to a
            release page with nothing on it for them, which is worse than not mentioning Linux.

            Older versions are per platform, so the link is per platform too: each panel carries its
            own, beside the files it describes.
          */}
        </Reveal>
      </Container>
    </Section>
  );
}
