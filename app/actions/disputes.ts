"use server";

import { auth } from "@clerk/nextjs/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { disputes, files } from "@/lib/db/schema";
import { logError } from "@/lib/logger";
import { sendDisputeFiledEmail } from "@/lib/email/templates/dispute-filed";
import { revalidatePath } from "next/cache";

const MIN_REASON = 10;
const MAX_REASON = 2000;

/**
 * Files a creator's dispute against their own auto-archived listing
 * (the geometry-collision flow). MVP workflow (CON-67): insert an `open`
 * row in `disputes` and email the operator, who reviews + resolves by
 * hand. Owner-gated; one open dispute per listing.
 */
export async function fileListingDispute(input: {
  fileId: string;
  reason: string;
}): Promise<{ ok: true } | { error: string }> {
  try {
    const { userId } = await auth();
    if (!userId) return { error: "Sign in required" };

    const reason = input.reason?.trim() ?? "";
    if (reason.length < MIN_REASON) {
      return {
        error: "Please explain why this is your original work (a sentence or two).",
      };
    }
    if (reason.length > MAX_REASON) {
      return { error: "Please keep your explanation under 2000 characters." };
    }

    const [file] = await db
      .select({
        id: files.id,
        name: files.name,
        slug: files.slug,
        ownerId: files.userId,
        flaggedReason: files.flaggedReason,
      })
      .from(files)
      .where(eq(files.id, input.fileId))
      .limit(1);

    if (!file) return { error: "Listing not found" };
    if (file.ownerId !== userId) {
      return { error: "You can only dispute your own listing." };
    }
    if (!file.flaggedReason) {
      return { error: "This listing isn't flagged, so there's nothing to dispute." };
    }

    // One open dispute per listing — don't let repeated clicks pile up.
    const [existingOpen] = await db
      .select({ id: disputes.id })
      .from(disputes)
      .where(and(eq(disputes.fileId, input.fileId), eq(disputes.status, "open")))
      .limit(1);
    if (existingOpen) {
      return { error: "You already have an open dispute for this listing." };
    }

    await db.insert(disputes).values({
      fileId: input.fileId,
      raisedByUserId: userId,
      reason,
    });

    // Best-effort operator notification — the dispute is already recorded,
    // so an email failure shouldn't fail the user's submission.
    try {
      await sendDisputeFiledEmail({
        fileName: file.name,
        fileSlug: file.slug,
        fileId: file.id,
        raisedByUserId: userId,
        reason,
      });
    } catch (error) {
      logError("fileListingDispute:email", error);
    }

    if (file.slug) revalidatePath(`/files/${file.slug}`);
    return { ok: true };
  } catch (error) {
    logError("fileListingDispute", error);
    return { error: "Failed to file dispute. Please try again." };
  }
}
