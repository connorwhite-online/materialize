import type { Metadata } from "next";
import { auth, currentUser } from "@clerk/nextjs/server";
import { notFound } from "next/navigation";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";

import { db } from "@/lib/db";
import { withDbRetry } from "@/lib/db/retry";
import {
  cadGenerations,
  cadThreads,
  fileAssets,
  files,
  projectFiles,
  projects,
} from "@/lib/db/schema";
import { generateDownloadUrl } from "@/lib/storage";
import { canUseTextToCad } from "@/lib/features";
import { isCadRating } from "@/lib/cad/feedback";
import { CAD_EXEMPLARS } from "@/lib/cad/knowledge/exemplars";
import { primaryEmail, type ClerkUserLike } from "@/lib/clerk-email";
import {
  TextToCadStudio,
  type StudioTurn,
  type StudioThread,
  type StudioTemplate,
} from "@/components/cad/text-to-cad-studio";
import { extractParams } from "@/components/cad/param-diff";

// Experimental owner-only surface — keep it out of search indexes even if
// the gate is ever misconfigured.
export const metadata: Metadata = {
  title: "Prometheus",
  robots: { index: false, follow: false },
};

const THREAD_LIMIT = 60;
const LEGACY_ROW_LIMIT = 100;

/** A "nice" slider step for a parameter of the given magnitude. */
function templateStep(value: number): number {
  const m = Math.abs(value);
  if (m >= 50) return 1;
  if (m >= 10) return 0.5;
  if (m >= 2) return 0.2;
  return 0.1;
}

/** Snap to the slider's step grid so displayed values stay clean. */
function roundToStep(v: number, step: number): number {
  return Math.round(v / step) * step;
}

/**
 * Verified exemplars → parametric template cards (MTR-190). Params are the
 * top-level numeric assignments `extractParams` reads (the same contract the
 * server-side substitution rewrites); ranges are ±50% of the authored value —
 * the documented fallback when an exemplar carries no explicit param metadata.
 * Zero-valued params are dropped (no meaningful ±50% range) and the list is
 * capped so a slider panel stays scannable. Computed once at module load since
 * the exemplar pool is a static import.
 */
const MAX_TEMPLATE_PARAMS = 8;
const STUDIO_TEMPLATES: StudioTemplate[] = CAD_EXEMPLARS.filter(
  (e) => e.verified
).map((e) => {
  const params = Object.entries(extractParams(e.code))
    .filter(([, value]) => value !== 0 && Number.isFinite(value))
    .slice(0, MAX_TEMPLATE_PARAMS)
    .map(([name, value]) => {
      const step = templateStep(value);
      const lo = value > 0 ? Math.max(step, value * 0.5) : value * 1.5;
      const hi = value > 0 ? value * 1.5 : value * 0.5;
      return {
        name,
        label: name.replace(/_/g, " "),
        value,
        min: roundToStep(Math.min(lo, hi), step),
        max: roundToStep(Math.max(lo, hi), step),
        step,
      };
    });
  return {
    id: e.id,
    title: e.title,
    blurb: e.lesson,
    keywords: e.keywords,
    params,
  };
});

/** StudioThread plus thread metadata the studio may adopt later. */
type StudioThreadWithMeta = StudioThread & {
  threadId?: string;
  activeGenerationId?: string | null;
  savedFileId?: string | null;
};

export default async function TextToCadPage() {
  const { userId } = await auth();
  const user = (await currentUser()) as ClerkUserLike;
  if (!userId || !canUseTextToCad(primaryEmail(user))) {
    notFound();
  }

  // Threads first-class (docs/text-to-cad/05 §A): load the user's threads
  // by recency, then their generations by threadId — no chain-walk
  // reconstruction, no 100-row fragmentation for threaded rows.
  const threadRows = await withDbRetry(() =>
    db
      .select({
        id: cadThreads.id,
        title: cadThreads.title,
        rootGenerationId: cadThreads.rootGenerationId,
        activeGenerationId: cadThreads.activeGenerationId,
        savedFileId: cadThreads.savedFileId,
        updatedAt: cadThreads.updatedAt,
      })
      .from(cadThreads)
      .where(eq(cadThreads.userId, userId))
      .orderBy(desc(cadThreads.updatedAt))
      .limit(THREAD_LIMIT)
  );
  const threadIds = threadRows.map((t) => t.id);

  const generationColumns = {
    id: cadGenerations.id,
    prompt: cadGenerations.prompt,
    title: cadGenerations.title,
    status: cadGenerations.status,
    renderStorageKey: cadGenerations.renderStorageKey,
    fileAssetId: cadGenerations.fileAssetId,
    projectId: cadGenerations.projectId,
    sourceCode: cadGenerations.sourceCode,
    parentGenerationId: cadGenerations.parentGenerationId,
    threadId: cadGenerations.threadId,
    error: cadGenerations.error,
    rating: cadGenerations.rating,
    feedbackTags: cadGenerations.feedbackTags,
    feedbackNote: cadGenerations.feedbackNote,
    createdAt: cadGenerations.createdAt,
  };

  const [threadGenRows, legacyRows] = await Promise.all([
    threadIds.length > 0
      ? withDbRetry(() =>
          db
            .select(generationColumns)
            .from(cadGenerations)
            .where(
              and(
                eq(cadGenerations.userId, userId),
                inArray(cadGenerations.threadId, threadIds)
              )
            )
            .orderBy(desc(cadGenerations.createdAt))
        )
      : Promise.resolve([]),
    // Legacy fallback: rows with no threadId yet. Pre-migration builds land
    // here whole; a threadId is also NULL on rows persisted mid-flight
    // (pending) — those attach to their parent's thread below. Once
    // scripts/backfill-cad-threads.ts has run in production, the
    // pre-migration case is empty and this query + the rootIdOf walk can
    // be retired.
    withDbRetry(() =>
      db
        .select(generationColumns)
        .from(cadGenerations)
        .where(
          and(
            eq(cadGenerations.userId, userId),
            isNull(cadGenerations.threadId)
          )
        )
        .orderBy(desc(cadGenerations.createdAt))
        .limit(LEGACY_ROW_LIMIT)
    ),
  ]);

  const rows = [...threadGenRows, ...legacyRows];

  // Reconstruct multi-part assemblies: each assembly generation links to a
  // Project bundling its part files, so an assembly survives reload/navigation
  // instead of collapsing to its primary part. Batch-load all parts at once.
  const projectIds = [
    ...new Set(rows.map((r) => r.projectId).filter((p): p is string => !!p)),
  ];
  const partsByProject = new Map<
    string,
    { slug: string; parts: { name: string; fileAssetId: string }[] }
  >();
  if (projectIds.length > 0) {
    const partRows = await withDbRetry(() =>
      db
        .select({
          projectId: projectFiles.projectId,
          slug: projects.slug,
          name: files.name,
          fileAssetId: fileAssets.id,
        })
        .from(projectFiles)
        .innerJoin(projects, eq(projects.id, projectFiles.projectId))
        .innerJoin(files, eq(files.id, projectFiles.fileId))
        .innerJoin(fileAssets, eq(fileAssets.fileId, files.id))
        .where(inArray(projectFiles.projectId, projectIds))
        .orderBy(projectFiles.position)
    );
    for (const pr of partRows) {
      const entry =
        partsByProject.get(pr.projectId) ?? { slug: pr.slug, parts: [] };
      // Part files are named "<assembly> — <part>"; show just the part.
      const name =
        pr.name && pr.name.includes(" — ")
          ? pr.name.split(" — ").slice(1).join(" — ")
          : pr.name ?? "part";
      entry.parts.push({ name, fileAssetId: pr.fileAssetId });
      partsByProject.set(pr.projectId, entry);
    }
  }

  // Mint a short-lived URL per render (local signing, no network round-trip).
  const turns: (StudioTurn & {
    parentGenerationId: string | null;
    threadId: string | null;
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
      // Rebuilt from the linked Project so assemblies survive reload.
      parts: r.projectId ? partsByProject.get(r.projectId)?.parts ?? [] : [],
      projectSlug: r.projectId
        ? partsByProject.get(r.projectId)?.slug ?? null
        : null,
      // Not persisted (no column yet) — the badge shows in-session only.
      remeshed: false,
      parentGenerationId: r.parentGenerationId,
      threadId: r.threadId,
      title: r.title,
      createdAt: r.createdAt.getTime(),
    }))
  );

  const byId = new Map(turns.map((t) => [t.id, t]));

  // Resolve a threadId for legacy/unlinked turns by walking the parent
  // chain: a pending revision (threadId not yet stamped) attaches to its
  // parent's thread. Falls back to the earliest fetched ancestor's id — the
  // old chain-walk grouping — for genuinely pre-migration rows. Retire with
  // the legacy query above after scripts/backfill-cad-threads.ts has run.
  const resolveThread = (
    t: (typeof turns)[number]
  ): { threadId: string | null; rootId: string } => {
    let cur = t;
    const seen = new Set<string>();
    while (!cur.threadId && cur.parentGenerationId && byId.has(cur.parentGenerationId)) {
      if (seen.has(cur.id)) break; // defensive: never loop on a cycle
      seen.add(cur.id);
      cur = byId.get(cur.parentGenerationId)!;
    }
    return { threadId: cur.threadId, rootId: cur.id };
  };

  const byThreadId = new Map<string, typeof turns>();
  const legacyGroups = new Map<string, typeof turns>();
  for (const t of turns) {
    const { threadId, rootId } = resolveThread(t);
    if (threadId) {
      (byThreadId.get(threadId) ?? byThreadId.set(threadId, []).get(threadId)!).push(t);
    } else {
      (legacyGroups.get(rootId) ?? legacyGroups.set(rootId, []).get(rootId)!).push(t);
    }
  }

  const initialThreads: StudioThreadWithMeta[] = [];

  const toStudioTurn = (m: (typeof turns)[number]): StudioTurn => ({
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
    remeshed: m.remeshed,
    parentGenerationId: m.parentGenerationId,
  });

  for (const thread of threadRows) {
    const members = byThreadId.get(thread.id);
    if (!members || members.length === 0) continue;
    const ordered = [...members].sort((a, b) => a.createdAt - b.createdAt);
    const rootTurn =
      (thread.rootGenerationId && byId.get(thread.rootGenerationId)) ||
      ordered[0];
    initialThreads.push({
      rootId: rootTurn.id,
      // Thread title first; root generation's title is the legacy fallback.
      title: thread.title ?? rootTurn.title ?? null,
      lastActivity: Math.max(...ordered.map((m) => m.createdAt)),
      turns: ordered.map(toStudioTurn),
      threadId: thread.id,
      activeGenerationId: thread.activeGenerationId,
      savedFileId: thread.savedFileId,
    });
  }

  for (const [rootId, members] of legacyGroups) {
    const ordered = [...members].sort((a, b) => a.createdAt - b.createdAt);
    initialThreads.push({
      rootId,
      title: byId.get(rootId)?.title ?? null,
      lastActivity: Math.max(...ordered.map((m) => m.createdAt)),
      turns: ordered.map(toStudioTurn),
    });
  }

  initialThreads.sort((a, b) => b.lastActivity - a.lastActivity);

  return (
    <TextToCadStudio
      initialThreads={initialThreads}
      templates={STUDIO_TEMPLATES}
    />
  );
}
