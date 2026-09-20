/**
 * Lint, and fail only if the count of existing problems goes UP.
 *
 * ── WHY A RATCHET AND NOT A GATE ─────────────────────────────────────────────────────────────────
 *
 * This repository arrived with 20 eslint errors and 2 warnings. They are real — unescaped quote
 * characters in the legal documents, `setState` called synchronously inside effects in three
 * marketing components, one `let` that should be `const` — and none of them is in the code paths
 * this repository was extracted to serve. Fixing them is worth doing and is not this commit.
 *
 * The two honest options were both bad. A blocking `npm run lint` would make CI red from the first
 * push, and a CI that is always red is a CI nobody reads — the next genuine failure arrives in a
 * job that was already failing. Dropping the step would mean nothing ever notices a new one.
 *
 * So: the baseline is committed, and the build fails when the count EXCEEDS it. Existing debt is
 * tolerated explicitly, with a number anyone can see; new debt fails immediately. Fixing something
 * lowers the count, which fails too — deliberately, because the baseline is then out of date and
 * lowering it should be part of the same commit as the fix. The message says the new number.
 *
 * ── THE COUNT IS ONLY MEANINGFUL WITH A LOCKFILE ─────────────────────────────────────────────────
 *
 * This number moved from 18 errors to 20 the first time the repository was installed without one:
 * the same source, linted by a newer `eslint-plugin-react-hooks` than the monorepo had resolved.
 * `package-lock.json` is committed, and `npm ci` is what CI runs, so the count describes the source
 * rather than the day the dependencies were fetched.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/** What this repository was extracted with. Lower it in the same commit as a fix. */
const BASELINE = JSON.parse(readFileSync(join(root, "lint-baseline.json"), "utf8"));

/*
 * eslint's own entry point, run by this Node, rather than `npx`.
 *
 * `spawnSync("npx.cmd", ...)` fails with EINVAL on Windows — Node refuses to spawn a `.cmd` without
 * a shell — and `shell: true` would then put every argument through cmd.exe's quoting rules for no
 * benefit. Resolving the script and running it directly works identically on every platform and
 * spawns one process instead of two.
 */
const eslintBin = join(root, "node_modules", "eslint", "bin", "eslint.js");
const run = spawnSync(process.execPath, [eslintBin, "--format", "json"], {
  cwd: root,
  encoding: "utf8",
  maxBuffer: 64 * 1024 * 1024,
});

// eslint exits 1 when it reports errors and 2 when it could not run at all. The second is not a
// lint result and must not be compared against a baseline.
if (run.error !== undefined || run.status === 2 || (run.stdout ?? "").trim() === "") {
  console.error("eslint could not run:");
  console.error(run.stderr || run.error?.message || "(no output)");
  process.exit(1);
}

let results;
try {
  results = JSON.parse(run.stdout);
} catch {
  console.error("eslint did not return JSON:");
  console.error(run.stdout.slice(0, 2000));
  process.exit(1);
}

const errors = results.reduce((n, file) => n + file.errorCount, 0);
const warnings = results.reduce((n, file) => n + file.warningCount, 0);

// A positive control on the runner: zero files means the config matched nothing, and every
// comparison below would then pass against a lint that examined no code at all.
if (results.length === 0) {
  console.error("eslint examined no files — check eslint.config.mjs");
  process.exit(1);
}

const worse = errors > BASELINE.errors || warnings > BASELINE.warnings;
const better = errors < BASELINE.errors || warnings < BASELINE.warnings;

console.log(
  `eslint: ${errors} error(s), ${warnings} warning(s) across ${results.length} file(s) ` +
    `(baseline ${BASELINE.errors}/${BASELINE.warnings})`
);

if (worse) {
  for (const file of results) {
    for (const message of file.messages) {
      if (message.severity !== 2) continue;
      console.error(`  ${file.filePath}:${message.line}:${message.column}  ${message.message}`);
    }
  }
  console.error(
    "\nMore lint problems than the committed baseline. Fix the new one, or — if it is genuinely\n" +
      "pre-existing and newly surfaced — raise lint-baseline.json in the same commit and say why.\n"
  );
  process.exit(1);
}

if (better) {
  console.error(
    `\nFewer problems than the baseline, which is good news and still a failure: lint-baseline.json\n` +
      `says ${BASELINE.errors}/${BASELINE.warnings}. Set it to {"errors": ${errors}, "warnings": ${warnings}} in this commit so the\n` +
      "ratchet cannot slip back.\n"
  );
  process.exit(1);
}
