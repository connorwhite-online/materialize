import type { Metadata } from "next";
import { auth, currentUser } from "@clerk/nextjs/server";
import { notFound } from "next/navigation";
import { desc, eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { withDbRetry } from "@/lib/db/retry";
import { cadGenerations } from "@/lib/db/schema";
import { generateDownloadUrl } from "@/lib/storage";
import { canUseTextToCad } from "@/lib/features";
import { isCadRating } from "@/lib/cad/feedback";
import { primaryEmail, type ClerkUserLike } from "@/lib/clerk-email";
import {
  TextToCadStudio,
  type StudioTurn,
  type StudioThread,
} from "@/components/cad/text-to-cad-studio";

// Experimental owner-only surface — keep it out of search indexes even if
// the gate is ever misconfigured.
export const metadata: Metadata = {
  title: "Text to CAD",
  robots: { index: false, follow: false },
};

export default async function TextToCadPage() {
  const { userId } = await auth();
  const user = (await currentUser()) as ClerkUserLike;
  if (!userId || !canUseTextToCad(primaryEmail(user))) {
    notFound();
  }

  const rows = await withDbRetry(() =>
    db
      .select({
        id: cadGenerations.id,
        prompt: cadGenerations.prompt,
        title: cadGenerations.title,
        status: cadGenerations.status,
        renderStorageKey: cadGenerations.renderStorageKey,
        fileAssetId: cadGenerations.fileAssetId,
        sourceCode: cadGenerations.sourceCode,
        parentGenerationId: cadGenerations.parentGenerationId,
        error: cadGenerations.error,
        rating: cadGenerations.rating,
        feedbackTags: cadGenerations.feedbackTags,
        feedbackNote: cadGenerations.feedbackNote,
        createdAt: cadGenerations.createdAt,
      })
      .from(cadGenerations)
      .where(eq(cadGenerations.userId, userId))
      .orderBy(desc(cadGenerations.createdAt))
      .limit(100)
  );

  // Mint a short-lived URL per render (local signing, no network round-trip).
  const turns: (StudioTurn & {
    parentGenerationId: string | null;
    title: string | null;
    createdAt: number;
  })[] = await Promise.all(
    rows.map(async (r) => ({
      id: r.id,
      prompt: r.prompt,
      status: r.status,
      renderUrl: r.renderStorageKey
        ? await generateDownloadUrl(r.renderStorageKey)
        : null,
      fileAssetId: r.fileAssetId,
      sourceCode: r.sourceCode,
      error: r.error,
      rating: isCadRating(r.rating) ? r.rating : null,
      feedbackTags: r.feedbackTags ?? [],
      feedbackNote: r.feedbackNote,
      // Multi-part reconstruction on reload is a follow-up; a reopened
      // assembly shows its primary part (the full set lives in its Project).
      parts: [],
      projectSlug: null,
      parentGenerationId: r.parentGenerationId,
      title: r.title,
      createdAt: r.createdAt.getTime(),
    }))
  );

  // Group generations into threads: walk each turn's parent chain to its
  // earliest fetched ancestor (the thread root). A linear chain of revisions
  // collapses to one thread; the root row carries the agent-written title.
  const byId = new Map(turns.map((t) => [t.id, t]));
  const rootIdOf = (t: (typeof turns)[number]): string => {
    let cur = t;
    const seen = new Set<string>();
    while (cur.parentGenerationId && byId.has(cur.parentGenerationId)) {
      if (seen.has(cur.id)) break; // defensive: never loop on a cycle
      seen.add(cur.id);
      cur = byId.get(cur.parentGenerationId)!;
    }
    return cur.id;
  };

  const groups = new Map<string, typeof turns>();
  for (const t of turns) {
    const root = rootIdOf(t);
    (groups.get(root) ?? groups.set(root, []).get(root)!).push(t);
  }

  const initialThreads: StudioThread[] = [...groups.entries()]
    .map(([rootId, members]) => {
      const ordered = [...members].sort((a, b) => a.createdAt - b.createdAt);
      const lastActivity = Math.max(...ordered.map((m) => m.createdAt));
      return {
        rootId,
        title: byId.get(rootId)?.title ?? null,
        lastActivity,
        turns: ordered.map<StudioTurn>((m) => ({
          id: m.id,
          prompt: m.prompt,
          status: m.status,
          renderUrl: m.renderUrl,
          fileAssetId: m.fileAssetId,
          sourceCode: m.sourceCode,
          error: m.error,
          rating: m.rating,
          feedbackTags: m.feedbackTags,
          feedbackNote: m.feedbackNote,
          parts: m.parts,
          projectSlug: m.projectSlug,
        })),
      };
    })
    .sort((a, b) => b.lastActivity - a.lastActivity);

  return <TextToCadStudio initialThreads={initialThreads} />;
}
