# voidcode-web

The public website for [VoidCode](https://github.com/) — a landing page, a download page, pricing,
and the Terms of Use and Privacy Policy. Next 16, static where it can be, deployed on Vercel.

It is **not** the application. The editor, the problems, the grader and the account all live in the
desktop app; this site describes them, hands over an installer, and publishes the legal documents.

## What is here

| Route | What it is |
|---|---|
| `/` | The landing page. Server-rendered text with nothing in front of the first paint |
| `/download` | Per-platform installers, read live from each platform's release feed |
| `/pricing` | Credit packs |
| `/terms`, `/privacy` | The legal documents, published for Stripe, the app stores, and anyone deciding whether to install |
| `/purchase/success`, `/purchase/cancelled` | Where Stripe Checkout returns |

There is no sign-in, no session and no API call. The site holds no credential — see
[`.env.example`](.env.example), which documents three variables and no secrets.

## Running it

```bash
npm install
cp .env.example .env.local
npm run dev
```

`npm run build` runs the legal verification first (below) and then `next build`.

## The legal documents are a copy, and that is the point

`src/components/Legal/{PrivacyClient,TermsClient}.tsx` are copies. The originals live in the desktop
application, because that is where a person clicks "I agree" and where registration records which
version they accepted. Neither package can import from the other.

**Do not edit them here.** Edit the application's copy, then re-sync.

`src/lib/legal.ts` carries a SHA-256 of each document's text, copied from the application.
`npm run verify:legal` hashes this repository's copy against it, and `prebuild` runs it — so a
deploy fails rather than publishing a legal document that is not the one the application records
consent against. That is deliberate: a stale privacy policy is a factual misstatement to the person
least able to check it.

What it cannot prove is that the *deployed* site serves the current version. Nothing in CI can,
without reaching the network. That is what deploying is for.

## The download page reads one repository

VoidCode publishes every installer — macOS, Windows and Linux — from a single public repository,
`hmmmx2/voidcode`. That name is a **constant** in
`src/components/marketing/sections/DownloadSection.tsx` and `scripts/resolve-release.mjs`, not an
environment variable, so there is nothing to set in Vercel and nothing to misconfigure.

It was two variables (`NEXT_PUBLIC_RELEASES_REPO_MAC`/`_WIN`) when the installers lived in separate
`voidcode-mac` and `voidcode-windows` repositories. Consolidating to one removed the indirection:
a `NEXT_PUBLIC_` value is inlined into the browser bundle at build time, and a wrong one — the wrong
repo, an empty value, or (the one that actually bit) a variable saved as a Vercel "Secret", which
Vercel then refuses to expose to the browser — silently blanked the download page and was invisible
until someone clicked. A constant cannot be misconfigured, and a public repository name is not a
secret.

The release feed is still read at build time by `scripts/resolve-release.mjs` (baked into
`src/generated/release.json`) and re-checked in the browser, so file names, sizes and checksums are
never hand-copied. Before the first release is published, the page says so rather than drawing a
button that 404s.

## Deploying

Vercel, from `main`. Nothing else is needed — there is no database, no API and no server-side
secret.

| Setting | Value |
|---|---|
| Framework | Next.js |
| Build command | `npm run build` (the default; `prebuild` runs the legal check) |
| Environment | `SITE_URL` (optional) — the installer repository is a constant, not a variable |

`SITE_URL` is the origin Next resolves relative metadata URLs against — the Open Graph card above
all. Unset, it falls back to Vercel's own `VERCEL_PROJECT_PRODUCTION_URL`, and only then to
`localhost`. That last fallback is the failure worth knowing about: it is invisible locally and
visible only to crawlers.

## Licence

Apache-2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
