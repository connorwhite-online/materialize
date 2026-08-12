import "server-only";

import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import { db } from "@/lib/db";
import { cadGenerations } from "@/lib/db/schema";
import { logError } from "@/lib/logger";
import { getObjectBytes, putObject } from "@/lib/storage";
import { CONCEPT_THREAD_REF_LABEL } from "./concept";
import type { PromptImage } from "./model-client";
import type { ThreadHistoryEntry } from "./types";

/**
 * Reference-image persistence + thread history (the "conversation graph").
 *
 * Before this module, a user's attached reference images lived only in the
 * generate request: the harness saw them for one turn and revisions inherited
 * code/brief/feedback but never the images — "make it more like the photo" on
 * turn 2 reached a model with no photo. Now each turn's references are stored
 * in R2 (`cad-refs/`, keys on cadGenerations.referenceImages, same pattern as
 * renderStorageKey) and revisions inherit the parent's list, so the whole
 * thread keeps building against the same references.
 *
 * Everything here is best-effort by contract: a storage or DB hiccup must
 * degrade to "this turn's own images only", never fail a generation.
 */

/** Hard cap on references per turn — matches the composer + route caps. */
export const MAX_REFERENCE_IMAGES = 4;

/** Ancestor turns shown to a revision prompt (beyond this, oldest drop). */
const HISTORY_CAP = 8;
/** Per-turn prompt budget in the history block. */
const HISTORY_PROMPT_CHARS = 240;

/** What cadGenerations.referenceImages stores: R2 key + media type, plus
 *  the caption the image carried when first stored — so an inherited
 *  repo-fetched image or chosen concept keeps its framing on later turns
 *  instead of being re-captioned as user-attached. Older rows lack it. */
export interface StoredReferenceImage {
  key: string;
  mediaType: string;
  label?: string;
}

const MAX_STORED_LABEL_CHARS = 300;

const MEDIA_EXT: Record<PromptImage["mediaType"], string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
};

const ALLOWED_MEDIA = new Set(Object.keys(MEDIA_EXT));

function isPromptMediaType(t: string): t is PromptImage["mediaType"] {
  return ALLOWED_MEDIA.has(t);
}

/**
 * Resolve the reference images for one generation turn: newly attached images
 * first, then the parent's stored references (revisions), capped at
 * MAX_REFERENCE_IMAGES. Persists the combined list (as R2 keys) on THIS
 * generation's row so the next revision inherits it in turn.
 *
 * Returns the in-memory PromptImages the engines should build against, or
 * undefined when the turn ends up with none.
 */
export async function resolveReferenceImages(opts: {
  generationId: string;
  userId: string;
  parentGenerationId?: string | null;
  images?: PromptImage[] | null;
}): Promise<PromptImage[] | undefined> {
  const fresh = (opts.images ?? []).slice(0, MAX_REFERENCE_IMAGES);

  // Inherited references: the parent's stored list (which already folded in
  // ITS parent's, so one hop covers the whole chain).
  let inherited: StoredReferenceImage[] = [];
  if (opts.parentGenerationId) {
    try {
      const [parent] = await db
        .select({ referenceImages: cadGenerations.referenceImages })
        .from(cadGenerations)
        .where(eq(cadGenerations.id, opts.parentGenerationId))
        .limit(1);
      inherited = (parent?.referenceImages ?? []).filter(
        (r): r is StoredReferenceImage =>
          !!r && typeof r.key === "string" && typeof r.mediaType === "string"
      );
    } catch (err) {
      logError("resolveReferenceImages.parent", err);
    }
  }

  // Upload this turn's new images. Per-image best-effort: a failed upload
  // keeps the image for THIS run (it's already in memory) but it won't
  // persist to later turns.
  const freshStored: (StoredReferenceImage | null)[] = await Promise.all(
    fresh.map(async (img) => {
      try {
        const key = `cad-refs/${opts.userId}/${nanoid()}.${MEDIA_EXT[img.mediaType]}`;
        await putObject(
          key,
          new Uint8Array(Buffer.from(img.data, "base64")),
          img.mediaType
        );
        return {
          key,
          mediaType: img.mediaType,
          ...(img.label
            ? { label: img.label.slice(0, MAX_STORED_LABEL_CHARS) }
            : {}),
        };
      } catch (err) {
        logError("resolveReferenceImages.upload", err);
        return null;
      }
    })
  );

  // Newest first: this turn's images, then the inherited ones, capped.
  // Inherited keys are shared with ancestor rows on purpose — the GC sweep
  // (cleanup-studio-artifacts) treats a key as live while ANY row lists it.
  const combined: StoredReferenceImage[] = [
    ...freshStored.filter((s): s is StoredReferenceImage => s !== null),
    ...inherited,
  ].slice(0, MAX_REFERENCE_IMAGES);

  if (combined.length > 0) {
    try {
      await db
        .update(cadGenerations)
        .set({ referenceImages: combined, updatedAt: new Date() })
        .where(eq(cadGenerations.id, opts.generationId));
    } catch (err) {
      logError("resolveReferenceImages.persist", err);
    }
  }

  // Load the inherited images we have room for (fresh ones are in memory).
  const inheritedToLoad = inherited.slice(
    0,
    Math.max(0, MAX_REFERENCE_IMAGES - fresh.length)
  );
  const loaded: (PromptImage | null)[] = await Promise.all(
    inheritedToLoad.map(async (ref) => {
      if (!isPromptMediaType(ref.mediaType)) return null;
      try {
        const bytes = await getObjectBytes(ref.key);
        return {
          data: Buffer.from(bytes).toString("base64"),
          mediaType: ref.mediaType,
          // Keep the stored framing (repo-fetched / concept) — an absent
          // label falls back to the default user-reference caption later.
          ...(ref.label ? { label: ref.label } : {}),
        };
      } catch (err) {
        logError("resolveReferenceImages.load", err);
        return null;
      }
    })
  );

  const images = [
    ...fresh,
    ...loaded.filter((i): i is PromptImage => i !== null),
  ];
  return images.length > 0 ? images : undefined;
}

/**
 * Walk the revision chain upward from the immediate parent and return the
 * thread's earlier turns oldest-first (capped at HISTORY_CAP). The immediate
 * parent's rating/note are omitted — the revise prompt already carries them
 * verbatim via priorFeedback, and saying it twice reads as two different
 * complaints.
 */
export async function buildThreadHistory(
  parentGenerationId: string
): Promise<ThreadHistoryEntry[]> {
  const chain: ThreadHistoryEntry[] = [];
  let cursor: string | null = parentGenerationId;
  for (let i = 0; i < HISTORY_CAP && cursor; i++) {
    const [row]: {
      prompt: string;
      parentGenerationId: string | null;
      rating: string | null;
      feedbackNote: string | null;
    }[] = await db
      .select({
        prompt: cadGenerations.prompt,
        parentGenerationId: cadGenerations.parentGenerationId,
        rating: cadGenerations.rating,
        feedbackNote: cadGenerations.feedbackNote,
      })
      .from(cadGenerations)
      .where(eq(cadGenerations.id, cursor))
      .limit(1);
    if (!row) break;
    const prompt =
      row.prompt.length > HISTORY_PROMPT_CHARS
        ? `${row.prompt.slice(0, HISTORY_PROMPT_CHARS)}…`
        : row.prompt;
    chain.push(
      i === 0
        ? { prompt }
        : { prompt, rating: row.rating, note: row.feedbackNote }
    );
    cursor = row.parentGenerationId;
  }
  return chain.reverse();
}

/**
 * Persist the concept render a finished build aimed toward as a thread
 * reference on its generation row, so revisions inherit the SAME aesthetic
 * target (the whole point of letting the user pick one). UPSERT semantics:
 * a thread carries at most ONE concept target — an existing concept entry
 * is replaced (a refine-turn pick supersedes it), and user refs always
 * outrank it (skipped when their slots are full). Best-effort: never throws.
 */
export async function appendConceptReference(opts: {
  generationId: string;
  userId: string;
  png: string;
}): Promise<void> {
  try {
    const [row] = await db
      .select({ referenceImages: cadGenerations.referenceImages })
      .from(cadGenerations)
      .where(eq(cadGenerations.id, opts.generationId))
      .limit(1);
    const existing = (row?.referenceImages ?? []).filter(
      (r): r is StoredReferenceImage =>
        !!r &&
        typeof r.key === "string" &&
        r.label !== CONCEPT_THREAD_REF_LABEL
    );
    if (existing.length >= MAX_REFERENCE_IMAGES) return;
    const key = `cad-refs/${opts.userId}/${nanoid()}.png`;
    await putObject(
      key,
      new Uint8Array(Buffer.from(opts.png, "base64")),
      "image/png"
    );
    await db
      .update(cadGenerations)
      .set({
        referenceImages: [
          ...existing,
          { key, mediaType: "image/png", label: CONCEPT_THREAD_REF_LABEL },
        ],
        updatedAt: new Date(),
      })
      .where(eq(cadGenerations.id, opts.generationId));
  } catch (err) {
    logError("appendConceptReference", err);
  }
}
