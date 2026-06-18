import type { Metadata } from "next";
import { auth, currentUser } from "@clerk/nextjs/server";
import { notFound } from "next/navigation";
import { desc, eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { cadGenerations } from "@/lib/db/schema";
import { generateDownloadUrl } from "@/lib/storage";
import { canUseTextToCad } from "@/lib/features";
import { isCadRating } from "@/lib/cad/feedback";
import { primaryEmail, type ClerkUserLike } from "@/lib/clerk-email";
import {
  TextToCadStudio,
  type StudioGeneration,
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

  const rows = await db
    .select({
      id: cadGenerations.id,
      prompt: cadGenerations.prompt,
      status: cadGenerations.status,
      renderStorageKey: cadGenerations.renderStorageKey,
      fileAssetId: cadGenerations.fileAssetId,
      sourceCode: cadGenerations.sourceCode,
      rating: cadGenerations.rating,
      feedbackTags: cadGenerations.feedbackTags,
      feedbackNote: cadGenerations.feedbackNote,
    })
    .from(cadGenerations)
    .where(eq(cadGenerations.userId, userId))
    .orderBy(desc(cadGenerations.createdAt))
    .limit(50);

  // Mint a short-lived URL per render (local signing, no network round-trip).
  const initialGenerations: StudioGeneration[] = await Promise.all(
    rows.map(async (r) => ({
      id: r.id,
      prompt: r.prompt,
      status: r.status,
      renderUrl: r.renderStorageKey
        ? await generateDownloadUrl(r.renderStorageKey)
        : null,
      fileAssetId: r.fileAssetId,
      sourceCode: r.sourceCode,
      rating: isCadRating(r.rating) ? r.rating : null,
      feedbackTags: r.feedbackTags ?? [],
      feedbackNote: r.feedbackNote,
    }))
  );

  return <TextToCadStudio initialGenerations={initialGenerations} />;
}
