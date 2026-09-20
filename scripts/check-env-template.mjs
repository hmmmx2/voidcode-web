/**
 * `.env.example` documents exactly what this site reads. No more, and no less.
 *
 * ── WHY BOTH DIRECTIONS, AND WHY THE SECOND IS THE ONE THAT BIT ──────────────────────────────────
 *
 * The missing direction is obvious: a template that omits a variable implies it does not exist, and
 * the next person cannot start the app.
 *
 * The EXTRA direction is the one that actually happened. This template documented TEN variables
 * while the site read ONE. `NEXT_PUBLIC_API_URL`, `API_INTERNAL_URL`, `INTERNAL_API_SECRET`,
 * `AUTH_SECRET`, `AUTH_TRUST_HOST` and five OAuth provider credentials all belonged to a
 * server-side auth proxy and a NextAuth session that were removed when sign-in moved into the
 * desktop application — and provider sign-in has since been removed from that too. `src/auth.ts`
 * does not exist.
 *
 * A template that asks for a secret implies something uses it. So the next person generates one,
 * sets it in Vercel, and believes this site holds a credential. It holds none. That is a worse
 * state than a missing variable, which at least fails loudly the first time something reads it.
 *
 * The check that existed in the monorepo verified only that this file was tracked by git and
 * contained no real secret. Nothing compared its contents to the source, which is how the drift
 * reached ten.
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const TEMPLATE = join(root, ".env.example");
const SRC = join(root, "src");

/** Set by the platform, never by a person: documenting them would mislead the other way. */
const PLATFORM_SUPPLIED = new Set(["NODE_ENV"]);

function* sources(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* sources(full);
    else if (/\.tsx?$/.test(entry.name)) yield full;
  }
}

const read = new Set();
for (const file of sources(SRC)) {
  for (const match of readFileSync(file, "utf8").matchAll(/process\.env\.([A-Z_0-9]+)/g)) {
    // `VERCEL_*` is the platform's own, set on every deployment.
    if (match[1].startsWith("VERCEL_")) continue;
    if (PLATFORM_SUPPLIED.has(match[1])) continue;
    read.add(match[1]);
  }
}

const documented = new Set();
for (const line of readFileSync(TEMPLATE, "utf8").split("\n")) {
  const found = /^#?\s*([A-Z_0-9]+)=/.exec(line.trim());
  if (found !== null) documented.add(found[1]);
}

const problems = [];

// Positive controls. Two empty sets agree perfectly and would prove nothing.
if (read.size === 0) problems.push("no process.env reads found in src/ — the pattern has stopped matching");
if (documented.size === 0) problems.push("no variables parsed out of .env.example");

for (const name of read) {
  if (!documented.has(name)) {
    problems.push(`.env.example does not document ${name}, which src/ reads`);
  }
}
for (const name of documented) {
  if (!read.has(name)) {
    problems.push(
      `.env.example documents ${name} and nothing in src/ reads it — a template that asks for a ` +
        "value implies something uses it"
    );
  }
}

// Named explicitly, because the absence of these is load-bearing rather than incidental: this site
// has no session, signs nothing and holds no credential.
for (const gone of [
  "AUTH_SECRET",
  "AUTH_TRUST_HOST",
  "INTERNAL_API_SECRET",
  "AUTH_GOOGLE_ID",
  "AUTH_MICROSOFT_ENTRA_ID_ID",
]) {
  if (documented.has(gone)) {
    problems.push(`.env.example offers ${gone} again, describing a system that was removed`);
  }
}

if (problems.length > 0) {
  console.error("The environment template does not match what this site reads:");
  console.error("");
  for (const problem of problems) console.error(`  - ${problem}`);
  console.error("");
  process.exit(1);
}

console.log(`Environment template verified (${documented.size} variable(s), all read by src/).`);
