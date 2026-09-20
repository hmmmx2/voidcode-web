/**
 * The landing page's demo shows the template the grader actually gives out.
 *
 * WHY THIS MATTERS MORE THAN IT LOOKS. The demo renders before any request resolves, so it cannot
 * be fetched — it is a copy. It is also the FIRST VoidCode code a visitor ever sees. If it drifts
 * from the catalogue, the learner sees one thing and the grader another, and the most public code
 * in the product is subtly not real.
 *
 * The application's repository asserts `contracts/demo-snippet.json` matches
 * `content/problems/stable-softmax.yaml`; this asserts the page matches the copy of that contract.
 * Neither half is sufficient: without the first the contract could drift from the catalogue and
 * this page would faithfully render the drift.
 *
 * `scripts/sync-from-app.mjs` refreshes the copy. Nothing here can know it is stale.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const CONTRACT = join(root, "src/lib/demo-snippet.json");
const PAGE = join(root, "src/lib/mock-data.ts");

const contract = JSON.parse(readFileSync(CONTRACT, "utf8"));
// CRs stripped with `fromCharCode`, not a regex: writing the escape here is what produced a
// literal newline inside a regex literal and a SyntaxError on the first attempt. Two checkouts
// can disagree about line endings while the code does not.
const source = readFileSync(PAGE, "utf8").split(String.fromCharCode(13)).join("");

/*
 * Read between the backticks of `export const defaultCode = ` ... ` `, which is what the page
 * declares. A template literal is the only form this can read, and that is asserted rather than
 * assumed: turning it into a concatenation or an import would make the check silently read
 * nothing.
 */
const OPEN = "export const defaultCode = `";
const open = source.indexOf(OPEN);
const problems = [];

if (open === -1) {
  problems.push("mock-data.ts no longer declares `defaultCode` as a plain template literal");
} else {
  const after = source.slice(open + OPEN.length);
  const close = after.indexOf("`");
  if (close === -1) {
    problems.push("`defaultCode`'s template literal is not terminated");
  } else {
    const onPage = after.slice(0, close);
    if (onPage !== contract.template_code) {
      problems.push(
        `defaultCode does not match ${contract.slug}'s template. The demo would show code the ` +
          "grader does not give out. Re-sync the contract, or fix the page — do not edit " +
          "src/lib/demo-snippet.json, which is the catalogue's text."
      );
    }
    // A positive control: an empty contract would match an empty page and prove nothing.
    if (contract.template_code.trim().length < 40) {
      problems.push("the contract's template is suspiciously short — re-export it");
    }
  }
}

if (problems.length > 0) {
  console.error("The landing page's demo snippet does not hold up:");
  for (const problem of problems) console.error(`  - ${problem}`);
  console.error("");
  process.exit(1);
}

console.log(`Demo snippet verified (${contract.slug}, ${contract.template_code.length} characters).`);
