import type { Metadata } from "next";
import { auth, currentUser } from "@clerk/nextjs/server";
import { notFound } from "next/navigation";
import { desc, eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { cadGenerations } from "@/lib/db/schema";
import { canUseTextToCad } from "@/lib/features";
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
      renderDataUrl: cadGenerations.renderDataUrl,
      fileAssetId: cadGenerations.fileAssetId,
    })
    .from(cadGenerations)
    .where(eq(cadGenerations.userId, userId))
    .orderBy(desc(cadGenerations.createdAt))
    .limit(50);

  const initialGenerations: StudioGeneration[] = rows.map((r) => ({
    id: r.id,
    prompt: r.prompt,
    status: r.status,
    renderDataUrl: r.renderDataUrl,
    fileAssetId: r.fileAssetId,
  }));

  return <TextToCadStudio initialGenerations={initialGenerations} />;
}
