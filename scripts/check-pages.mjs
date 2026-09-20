/**
 * The pages exist, everything points at something, and nothing advertises what does not ship.
 *
 * ── WHERE THESE CHECKS COME FROM ─────────────────────────────────────────────────────────────────
 *
 * `tests/test_marketing_pages.py` in the application's monorepo, ported here when this repository
 * was extracted. Nothing on these pages is rendered from a database, so nothing else would notice
 * if a link pointed at a deleted route or the copy started describing a feature that does not
 * exist. The pricing half of that file is `check-pricing.mjs`; this is the rest.
 *
 * TWO OF ITS TESTS ARE DELETED RATHER THAN PORTED, and both because their subject is gone:
 *
 *   * the Docker `HEALTHCHECK` probing a route that exists — it caught a real defect, an image that
 *     built and served correctly while `docker ps` reported `(unhealthy)` forever. The Dockerfile
 *     is deleted: it copied `pnpm-lock.yaml` and filtered `@voidcode/web`, so it could not build
 *     here, and this site deploys to Vercel.
 *   * the `COPY` paths all existing — same Dockerfile.
 *
 * Deleting the subject deletes the need. Saying so is what stops the next person reintroducing a
 * Dockerfile without its two guards.
 */
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(root, "src");

/** Every page the site serves, by route, with the file that renders it. */
const PAGES = {
  "/": "app/(marketing)/page.tsx",
  "/pricing": "app/(marketing)/pricing/page.tsx",
  "/download": "app/(marketing)/download/page.tsx",
  "/terms": "app/(legal)/terms/page.tsx",
  "/privacy": "app/(legal)/privacy/page.tsx",
  "/purchase/success": "app/(legal)/purchase/success/page.tsx",
  "/purchase/cancelled": "app/(legal)/purchase/cancelled/page.tsx",
};

const problems = [];

/** Rendered text: comments removed, JSX tags stripped, whitespace flattened. */
function textOf(file) {
  return readFileSync(file, "utf8")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*\/\/.*$/gm, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&[a-z]+;/g, " ")
    .replace(/\s+/g, " ");
}

function* tsxFiles(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* tsxFiles(full);
    else if (/\.tsx?$/.test(entry.name)) yield full;
  }
}

// ── Every page has a file ─────────────────────────────────────────────────────
for (const [route, file] of Object.entries(PAGES)) {
  const full = join(SRC, file);
  if (!existsSync(full) || !statSync(full).isFile()) problems.push(`${route} has no ${file}`);
}

// ── Every internal link resolves ──────────────────────────────────────────────
//
// `/login` was linked from the footer for one commit after that page was deleted. Literal hrefs
// only: a template literal is not statically checkable, and pretending otherwise means either false
// failures or a check nobody trusts.
const routes = new Set(Object.keys(PAGES));
for (const file of tsxFiles(SRC)) {
  const source = readFileSync(file, "utf8");
  for (const match of source.matchAll(/href[:=]\s*"(\/[^"#]*)"/g)) {
    const href = match[1].replace(/\/$/, "") || "/";
    if (href.startsWith("/api/")) continue;
    if (!routes.has(href)) {
      problems.push(`${href} is linked from ${relative(SRC, file)} and is not a route`);
    }
  }
}

// ── The nav offers the three pages and nothing stale ──────────────────────────
//
// The nav renders on every page, so an anchor in it works on one and does nothing on the others.
const navFile = join(SRC, "components/marketing/sections/MarketingNav.tsx");
if (!existsSync(navFile)) {
  problems.push("MarketingNav.tsx is missing, so the nav cannot be checked");
} else {
  const nav = readFileSync(navFile, "utf8");
  const open = nav.indexOf("export const NAV_LINKS = [");
  if (open === -1) {
    problems.push("MarketingNav.tsx no longer exports NAV_LINKS in a form this can read");
  } else {
    const block = nav.slice(open).split("];", 1)[0];
    const hrefs = [...block.matchAll(/href:\s*"([^"]+)"/g)].map((m) => m[1]);
    const want = ["/", "/pricing", "/download"];
    if (hrefs.join(",") !== want.join(",")) {
      problems.push(`the nav links are [${hrefs}], expected [${want}]`);
    }
    if (hrefs.some((h) => h.includes("#"))) problems.push("the page nav carries an anchor again");
  }
}

// ── Nothing advertises an unshipped feature ───────────────────────────────────
//
// The most public place in the product is the one most tempted to describe a plan. The research
// library is a later phase, and Google and Microsoft sign-in has been REMOVED from the desktop
// application — so a page offering it would be advertising something that was TAKEN AWAY rather
// than something not yet built, which is worse.
//
// EVERY COMPONENT, NOT JUST THE PAGE FILES. The version of this check in the monorepo read only
// the page files under `app/` and nothing they import, and a mutant proved the hole: adding "research library" to
// `PricingPlans.tsx` — where essentially all of the copy actually lives — changed nothing, because
// a page file is a dozen lines that import sections. Scanning what renders is the only scope that
// answers the question.
//
// `components/Legal` is excluded: those are copies of the application's own documents, checked by
// `check-legal-digest.mjs` instead, and the Privacy Policy legitimately discusses provider sign-in
// in order to say it is not offered.
for (const file of tsxFiles(SRC)) {
  // `sep`, not a regex: writing a backslash class here is what produced `/\/g` and a syntax
  // error on the first attempt — and a script that cannot parse exits non-zero, which looked
  // exactly like the check catching something.
  if (relative(SRC, file).split(sep).join("/").startsWith("components/Legal/")) continue;
  const rendered = textOf(file).toLowerCase();
  for (const unshipped of [
    "research paper",
    "research library",
    "sign in with google",
    "sign in with microsoft",
  ]) {
    if (rendered.includes(unshipped)) {
      problems.push(`${relative(SRC, file)} advertises "${unshipped}"`);
    }
  }
}

// ── The payment return pages stay out of search results ───────────────────────
//
// They are reached with a Stripe session id in the URL and say nothing useful out of context.
for (const route of ["/purchase/success", "/purchase/cancelled"]) {
  const full = join(SRC, PAGES[route]);
  if (!existsSync(full)) continue;
  const source = readFileSync(full, "utf8");
  if (!source.includes("robots") || !source.includes("index: false")) {
    problems.push(`${route} is indexable`);
  }
}

// A positive control on the whole file: if PAGES emptied or the walk found nothing, every loop
// above would pass by examining nothing.
if (Object.keys(PAGES).length < 5) problems.push("fewer than five pages are declared");
if ([...tsxFiles(SRC)].length < 20) problems.push("the source walk found almost no .tsx files");

if (problems.length > 0) {
  console.error("The pages do not hold up:\n");
  for (const problem of problems) console.error(`  - ${problem}`);
  console.error("");
  process.exit(1);
}

console.log(`Pages verified (${Object.keys(PAGES).length} routes, links and copy).`);
