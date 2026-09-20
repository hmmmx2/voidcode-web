/**
 * Every state `resolve-release.mjs` can reach, exercised against a stub.
 *
 * WHY THIS IS NOT OPTIONAL. That script decides whether the download page draws a button, and two
 * of its three answers are the ones that caused a defect: a page that offered
 * `releases/latest/download/<file>` when nothing was published returned `404 Not Found` to a real
 * visitor. Proving `none` draws nothing and `unknown` names no file is the whole point.
 *
 * Proving it against the real API is a matter of luck — 60 anonymous requests an hour per IP, and
 * the state under test is "there is no release yet", which stops being reproducible the moment one
 * is published. So the API is stubbed and every branch is asserted.
 */
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
/**
 * A TEMPORARY output, never `src/generated/release.json`.
 *
 * This wrote to the real path and deleted it at the end, which broke the build: `verify` runs after
 * `resolve:release`, so the cleanup removed the file `next build` was about to import and the build
 * failed with two Turbopack errors that named nothing. The script under test takes an output
 * override for exactly this.
 */
const TARGET = join(mkdtempSync(join(tmpdir(), "voidcode-release-states-")), "release.json");
const PORT = Number(process.env.VOIDCODE_RELEASE_STUB_PORT ?? 8791);

/** What the stub answers for `/repos/<owner>/<repo>/releases/latest`, set per case. */
let reply = { status: 404, body: {} };

const server = createServer((request, response) => {
  response.writeHead(reply.status, { "content-type": "application/json" });
  response.end(JSON.stringify(reply.body));
});
await new Promise((ready) => server.listen(PORT, "127.0.0.1", ready));

/**
 * `spawn` and awaited, NOT `spawnSync`, and the first version of this got it wrong in a way worth
 * recording: `spawnSync` blocks the parent's event loop, the stub server lives IN the parent, so
 * the child's request could never be accepted and every case failed with
 * "could not reach GitHub: TimeoutError". A stub and a synchronous child in one process is a
 * deadlock, and it presents as the thing under test being broken.
 */
const run = () =>
  new Promise((done) => {
    const child = spawn(process.execPath, [join(root, "scripts", "resolve-release.mjs")], {
      env: {
        ...process.env,
        VOIDCODE_RELEASE_API_BASE: `http://127.0.0.1:${PORT}`,
      VOIDCODE_RELEASE_OUT: TARGET,
        NEXT_PUBLIC_RELEASES_REPO_MAC: "owner/mac",
        NEXT_PUBLIC_RELEASES_REPO_WIN: "owner/win",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("close", () => done({ stdout, stderr }));
  });

const problems = [];
const expect = (what, actual, wanted) => {
  if (actual !== wanted) problems.push(`${what}: expected ${String(wanted)}, got ${String(actual)}`);
};

// ── none: GitHub answers 404. No release, so no link can work. ────────────────────────────────
reply = { status: 404, body: { message: "Not Found" } };
await run();
let baked = JSON.parse(readFileSync(TARGET, "utf8"));
expect("404 -> mac.state", baked.mac.state, "none");
expect("404 -> win.state", baked.win.state, "none");

// ── unknown: rate-limited. Nothing is known, so no file may be named. ─────────────────────────
reply = { status: 403, body: { message: "API rate limit exceeded" } };
await run();
baked = JSON.parse(readFileSync(TARGET, "utf8"));
expect("403 -> mac.state", baked.mac.state, "unknown");

// ── published: the release carries exactly the names the page links. ──────────────────────────
const MAC = ["VoidCode-macOS-AppleSilicon.dmg", "VoidCode-macOS-Intel.dmg"];
const WIN = ["VoidCode-Windows-x64-Setup.exe", "VoidCode-Windows-ARM64-Setup.exe"];
reply = {
  status: 200,
  body: {
    tag_name: "v9.9.9",
    published_at: "2026-01-01T00:00:00Z",
    assets: [...MAC, ...WIN].map((name) => ({ name, size: 12345 })),
  },
};
await run();
baked = JSON.parse(readFileSync(TARGET, "utf8"));
expect("200 -> mac.state", baked.mac.state, "published");
expect("200 -> mac.tag", baked.mac.tag, "v9.9.9");
expect("200 -> a size is carried", baked.mac.sizes?.[MAC[0]], 12345);

// ── DRIFT: a release that does not carry the names the page links. ────────────────────────────
//
// The failure this guards is a rename in the desktop repo's `distribute` job. Without it the
// symptom is a visitor's 404; with it, the build says so. It must NOT report `published`.
reply = {
  status: 200,
  body: { tag_name: "v9.9.9", assets: [{ name: "VoidCode-0.1.0-mac-arm64.dmg", size: 1 }] },
};
const drifted = await run();
baked = JSON.parse(readFileSync(TARGET, "utf8"));
expect("renamed assets -> mac.state", baked.mac.state, "unknown");
if (!/is missing/.test(String(drifted.stderr))) {
  problems.push("a renamed asset did not say which name was missing");
}

server.close();
// Only this check's own temporary file. The build's artefact was never written to.
rmSync(dirname(TARGET), { recursive: true, force: true });

if (problems.length > 0) {
  console.error("resolve-release.mjs does not behave as the page assumes:");
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
console.log("Release states verified (none, unknown, published, and a renamed-asset drift).");
