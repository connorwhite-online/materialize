import type { Metadata } from "next";
import Link from "next/link";
import { auth, currentUser } from "@clerk/nextjs/server";
import { notFound } from "next/navigation";

import { canUseTextToCad } from "@/lib/features";
import { CAD_EXEMPLARS } from "@/lib/cad/knowledge/exemplars";
import { primaryEmail, type ClerkUserLike } from "@/lib/clerk-email";
import { extractParams } from "@/components/cad/param-diff";
import {
  ExemplarsDebug,
  type ExemplarDescriptor,
} from "@/components/cad/exemplars-debug";

// Owner-only debug surface — keep it out of search indexes even if the gate
// is ever misconfigured.
export const metadata: Metadata = {
  title: "Prometheus — Exemplars",
  robots: { index: false, follow: false },
};

/**
 * Verified exemplars as an owner-only debug gallery (MTR-208). This is the
 * "better way" to eyeball the exemplar pool for debugging without putting it
 * in a user's face on the studio empty state: each verified exemplar shows its
 * name, a verified flag, its read-only authored parameters, and an owner-only
 * "build this" that instantiates it through the SAME render/thumbnail path
 * (`runCadTemplate`) the template gallery used to drive. The slider-based
 * parametric instantiation machinery survives here; the user-facing gallery is
 * gone.
 *
 * The exemplar `code` carries no pre-rendered thumbnail, so a thumbnail only
 * exists after "build this" runs the sidecar — which is exactly the debug loop
 * this page exists to support.
 */
const DESCRIPTORS: ExemplarDescriptor[] = CAD_EXEMPLARS.map((e) => ({
  id: e.id,
  title: e.title,
  lesson: e.lesson,
  keywords: e.keywords,
  verified: e.verified,
  params: Object.entries(extractParams(e.code))
    .filter(([, value]) => Number.isFinite(value))
    .map(([name, value]) => ({ name, value })),
}));

export default async function ExemplarsPage() {
  const { userId } = await auth();
  const user = (await currentUser()) as ClerkUserLike;
  if (!userId || !canUseTextToCad(primaryEmail(user))) {
    notFound();
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">
          Prometheus — Exemplars
        </h1>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <Link
            href="/prometheus/eval"
            className="underline-offset-2 hover:underline"
          >
            Scorecard
          </Link>
          <Link
            href="/prometheus"
            className="underline-offset-2 hover:underline"
          >
            ← Studio
          </Link>
        </div>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        The verified-exemplar pool the harness learns taste from. Owner-only
        debug view — “Build this” instantiates a verified exemplar through the
        sidecar (no LLM) so you can eyeball the actual geometry.
      </p>

      <ExemplarsDebug exemplars={DESCRIPTORS} />
    </div>
  );
}
