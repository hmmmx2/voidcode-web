import type { NextConfig } from "next";

/**
 * ── WHAT THIS FILE USED TO CARRY, AND WHY NONE OF IT SURVIVED THE EXTRACTION ─────────────────────
 *
 * `output: "standalone"` was here, with a comment saying it was "required to containerise this app
 * at all". The Dockerfile it existed for is DELETED: it copied `pnpm-lock.yaml`,
 * `pnpm-workspace.yaml` and `apps/web/package.json`, filtered `@voidcode/web`, and pathed
 * everything under `/repo/apps/web/` — none of which exists in this repository. It could not have
 * built, and this site deploys to Vercel, which does not use a Dockerfile.
 *
 * `images.remotePatterns` allowed `lh3.googleusercontent.com` and `graph.microsoft.com`. Those were
 * profile photos for a signed-in UI that moved into the desktop application, and Google and
 * Microsoft sign-in has since been removed from that too. Nothing here renders a remote image —
 * checked, not assumed: there is no `next/image` import in `src/` at all. A standing allowance for
 * two third-party image hosts, held open for a feature that does not exist in any part of this
 * product, is the kind of setting that looks like a decision.
 *
 * What is left is the one thing this site actually uses.
 */
const nextConfig: NextConfig = {
  reactCompiler: true,
};

export default nextConfig;
