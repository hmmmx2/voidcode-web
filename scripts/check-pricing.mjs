/**
 * Refuse to build if the pricing page advertises a price the API does not charge.
 *
 * ── WHY THIS IS THE MOST CONSEQUENTIAL CHECK IN THIS REPOSITORY ──────────────────────────────────
 *
 * This page is static. It cannot ask the API what a pack costs, so its numbers are a COPY — and the
 * API's table is append-only precisely because a pack's credit amount is baked into completed
 * purchases. A page that says RM20 buys 1,200 credits while the webhook grants something else is a
 * false price published to the public internet, and the person who finds out is the one who paid.
 *
 * While the website lived in the monorepo, a Python test compared this page with
 * `apps/api/src/services/credit_packs.py` directly. There is no second tree to read now. The claim
 * is split, exactly like the legal documents' digest:
 *
 *   * The application's repository exports `contracts/credit-packs.json` and asserts it matches
 *     `credit_packs.py` — including an AST re-parse, so a broken exporter cannot agree with itself.
 *   * `src/lib/credit-packs.json` is a copy of that contract, and this script asserts the page
 *     matches it.
 *
 * Neither half is sufficient alone. Without the first, the contract could drift from the API and
 * this repository would faithfully publish the drift. Without this one, the contract could be right
 * and the page wrong.
 *
 * ── WHAT IT CANNOT PROVE ─────────────────────────────────────────────────────────────────────────
 *
 * That the copy is CURRENT. If a price changes in the application and nobody re-copies the contract
 * here, this check passes and the page is stale. Nothing in this repository can know that — the
 * authoritative table is somewhere else. `scripts/sync-from-app.mjs` is how the copy is refreshed,
 * and the price is the reason that step is documented rather than left to memory.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const CONTRACT = join(root, "src/lib/credit-packs.json");
const PAGE = join(root, "src/components/marketing/sections/PricingPlans.tsx");

const problems = [];

/** The packs as the page prints them, read out of its own `PACKS` array. */
function pagePacks() {
  const source = readFileSync(PAGE, "utf8");
  const open = source.indexOf("const PACKS: Pack[] = [");
  if (open === -1) return null;
  const body = source.slice(open).split("\n];", 1)[0];

  const packs = [];
  for (const block of body.match(/\{[^{}]*\}/g) ?? []) {
    const code = /code:\s*"([^"]+)"/.exec(block);
    const label = /label:\s*"([^"]+)"/.exec(block);
    const price = /price:\s*"([^"]+)"/.exec(block);
    const credits = /credits:\s*(\d+)/.exec(block);
    if (code === null || label === null || price === null || credits === null) continue;
    packs.push({
      code: code[1],
      label: label[1],
      price_display: price[1],
      credits: Number(credits[1]),
    });
  }
  return packs;
}

const contract = JSON.parse(readFileSync(CONTRACT, "utf8")).packs;
const page = pagePacks();

if (page === null) {
  problems.push("PricingPlans.tsx has no `const PACKS: Pack[] = [` array to read");
} else if (page.length === 0) {
  // A positive control on the parse. An empty list would agree with nothing missing and report
  // success for a page that offers no packs at all.
  problems.push("no packs were parsed out of PricingPlans.tsx — the array's shape has changed");
} else {
  const byCode = (list) => new Map(list.map((p) => [p.code, p]));
  const onPage = byCode(page);
  const inContract = byCode(contract);

  // BOTH DIRECTIONS. A pack the page omits is one nobody can find; a pack the page invents is one
  // the checkout refuses, after the buyer has decided to pay for it.
  for (const code of inContract.keys()) {
    if (!onPage.has(code)) problems.push(`${code} is on sale and the page does not offer it`);
  }
  for (const code of onPage.keys()) {
    if (!inContract.has(code)) {
      problems.push(`the page offers ${code}, which is not on sale — checkout would refuse it`);
    }
  }

  for (const [code, want] of inContract) {
    const got = onPage.get(code);
    if (got === undefined) continue;
    if (got.price_display !== want.price_display) {
      problems.push(`${code}: the page says ${got.price_display}, the API charges ${want.price_display}`);
    }
    if (got.credits !== want.credits) {
      problems.push(`${code}: the page promises ${got.credits} credits, the webhook grants ${want.credits}`);
    }
    if (got.label !== want.label) {
      problems.push(`${code}: label is "${got.label}" on the page and "${want.label}" in the API`);
    }
  }
}

/**
 * ── THE SENTENCE ABOUT WHERE THE RATE COMES FROM ─────────────────────────────────────────────────
 *
 * The page states what the rate behind its estimates is. That is a claim about the API's pricing
 * table, and it was WRONG for ten days: the page said "a projection ... rather than a measured
 * throughput" while the live row carried `measured=True`.
 *
 * It survived because the guard searched the whole of `gpu_pricing.py` for `measured=False`, and
 * that table is APPEND-ONLY — two superseded rows still say it. A substring search over a file that
 * keeps its history cannot answer a question about the present, so the contract now carries the
 * LIVE row's flag, resolved the way the API resolves it.
 *
 * Checked in BOTH directions, because either is a false statement to someone deciding whether to
 * pay: claiming a measured rate when it is a projection overstates the basis, and claiming a
 * projection when it is measured understates it while making the page look out of date.
 */
const rate = JSON.parse(readFileSync(CONTRACT, "utf8")).serving_rate;
const rendered = readFileSync(PAGE, "utf8")
  // Comments go first: this file explains the correction at length, and the explanation quotes the
  // wording being checked for. Scanning the raw source would match the note about the bug.
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, " ")
  .replace(/\/\*[\s\S]*?\*\//g, " ")
  .replace(/^\s*\/\/.*$/gm, " ")
  .replace(/<[^>]+>/g, " ")
  .replace(/\s+/g, " ");

/*
 * KEYED ON ONE DISTINCTIVE PHRASE, not on a lookahead.
 *
 * The first attempt used `/projection(?![^.]*rather than)/` — "projection" unless "rather than"
 * follows it — and immediately failed on the CORRECTED wording, which reads "comes from measured
 * throughput rather than a projection": the qualifier precedes the word rather than following it.
 * A regex encoding an assumed word order is a check that constrains the prose rather than the
 * claim.
 *
 * `rather than a measured throughput` appears only in the FALSE form, and says the whole thing: it
 * asserts the rate is not measured. So that phrase is required when the rate is unmeasured and
 * forbidden when it is measured, and the page is free to word the rest however it likes.
 */
const DENIES_MEASUREMENT = /rather than a\s+measured throughput/i;

if (rate === undefined || typeof rate.measured !== "boolean") {
  problems.push("the contract carries no `serving_rate.measured` — re-run the app's exporter");
} else if (rate.measured) {
  if (DENIES_MEASUREMENT.test(rendered)) {
    problems.push(
      "the page says the rate is not a measured throughput; the live pricing row is measured " +
        `(effective ${rate.effective_from})`
    );
  }
  if (!/measured throughput/i.test(rendered)) {
    problems.push(
      "the page does not mention measured throughput at all, which is what the live row reports"
    );
  }
} else {
  // Unmeasured: the page must SAY so, and must not print the rate as a headline promise. The
  // failure this guards is in `gpu_pricing.py`'s own notes — credits denominated in US cents while
  // packs sold in ringgit, so a RM20 pack granted about RM56 of GPU while every figure in the
  // ledger stayed arithmetically correct.
  if (!DENIES_MEASUREMENT.test(rendered)) {
    problems.push("the rate is a projection and the page does not say it is not measured");
  }
  for (const invented of ["hours of tutoring", "hours of answers", "unlimited", "per month", "/month"]) {
    if (rendered.toLowerCase().includes(invented)) {
      problems.push(`the rate is not measured and the page claims "${invented}"`);
    }
  }
}

/*
 * What a credit IS, which is the claim that replaced the headline. Stable regardless of
 * measurement, and the reason the page is readable at all: a price list in an invented unit is
 * worse than no price list.
 */
if (!/one sen of GPU cost/i.test(rendered)) {
  problems.push("the page no longer says what a credit is (one sen of GPU cost)");
}
for (const included of ["Apache", "grader", "local model", "no account"]) {
  if (!rendered.toLowerCase().includes(included.toLowerCase())) {
    problems.push(`the free column no longer mentions ${included}`);
  }
}

if (problems.length > 0) {
  console.error("The pricing page does not match the API's packs:\n");
  for (const problem of problems) console.error(`  - ${problem}`);
  console.error(
    "\nRefusing to build. Either the page is wrong, or `src/lib/credit-packs.json` is out of date —\n" +
      "run `node scripts/sync-from-app.mjs <path-to-voidcode-checkout>` to refresh the contract.\n" +
      "Do not edit the contract by hand to match the page: it is the API's table, not this page's.\n"
  );
  process.exit(1);
}

console.log(`Pricing verified (${contract.length} pack(s) match the API's contract).`);
