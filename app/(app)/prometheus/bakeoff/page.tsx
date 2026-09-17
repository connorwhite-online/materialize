import type { Metadata } from "next";
import Link from "next/link";
import { auth, currentUser } from "@clerk/nextjs/server";
import { notFound } from "next/navigation";

import { canUseTextToCad } from "@/lib/features";
import { primaryEmail, type ClerkUserLike } from "@/lib/clerk-email";
import { BakeoffPanel } from "@/components/cad/bakeoff-panel";

// Experimental owner-only surface — keep it out of search indexes even if the
// gate is ever misconfigured, matching the other /prometheus pages.
export const metadata: Metadata = {
  title: "Prometheus — Engine bake-off",
  robots: { index: false, follow: false },
};

/**
 * Side-by-side engine comparison (docs/text-to-cad/11).
 *
 * The gate is called HERE, in the page, not in a layout: Next's own auth
 * guidance is explicit that layouts do not re-render on navigation, so the
 * session is not re-checked on a route change. Same reasoning the /internal
 * tools document.
 *
 * `/prometheus(.*)` is already in PUBLIC_ROUTES, which reads backwards and
 * is not: "public" there means public at the PROXY layer only, so this
 * page's own gate gets to run and notFound(). Reaching auth.protect()
 * instead would redirect an anonymous visitor to sign-in, which tells them
 * the route exists.
 */
export default async function BakeoffPage() {
  const { userId } = await auth();
  const user = (await currentUser()) as ClerkUserLike;
  if (!userId || !canUseTextToCad(primaryEmail(user))) {
    notFound();
  }

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-10">
      <div className="mb-6 flex flex-col gap-2">
        <Link
          href="/prometheus"
          className="text-xs text-muted-foreground hover:underline"
        >
          ← Prometheus
        </Link>
        <h1 className="text-xl font-medium">Engine bake-off</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          One prompt, one or both geometry engines, side by side. This is a
          comparison with a scheduled end, not a permanent feature — for the
          numbers that actually decide it, run{" "}
          <code className="rounded bg-muted px-1 py-0.5">npm run bench:cad</code>{" "}
          over the frozen case set. This page is for looking at the parts.
        </p>
      </div>
      <BakeoffPanel />
    </main>
  );
}
