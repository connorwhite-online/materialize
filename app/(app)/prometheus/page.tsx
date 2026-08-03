import type { Metadata } from "next";
import { auth, currentUser } from "@clerk/nextjs/server";
import { notFound } from "next/navigation";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";

import { db } from "@/lib/db";
import { withDbRetry } from "@/lib/db/retry";
import {
  cadGenerations,
  cadJobs,
  cadThreads,
  fileAssets,
  files,
  projectFiles,
  projects,
} from "@/lib/db/schema";
import { generateDownloadUrl } from "@/lib/storage";
import { canUseTextToCad } from "@/lib/features";
import { isCadRating } from "@/lib/cad/feedback";
import { parseFeatures } from "@/lib/cad/features";
import { primaryEmail, type ClerkUserLike } from "@/lib/clerk-email";
import {
  TextToCadStudio,
  type StudioTurn,
  type StudioThread,
} from "@/components/cad/text-to-cad-studio";

// Experimental owner-only surface — keep it out of search indexes even if
// the gate is ever misconfigured.
export const metadata: Metadata = {
  title: "Prometheus",
  robots: { index: false, follow: false },
};

const THREAD_LIMIT = 60;
const LEGACY_ROW_LIMIT = 100;
// Generations across the user's THREAD_LIMIT most-recently-updated
// threads had no cap at all — a power user with a long history could
// pull thousands of rows (each carrying the sourceCode blob) into a
// single request. Mirrors the sibling LEGACY_ROW_LIMIT bound below,
// sized larger since this bucket spans up to 60 threads rather than
// one flat legacy pile. Same accepted characteristic as the legacy
// cap: ordered by createdAt desc, so in the rare case a user exceeds
// this many generations across their recent threads, their oldest
// touched thread in THREAD_LIMIT could end up with zero fetched turns
// and silently drop from the list (existing precedent, not new).
const THREAD_GEN_LIMIT = 1000;

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
    features: cadGenerations.features,
    parentGenerationId: cadGenerations.parentGenerationId,
    threadId: cadGenerations.threadId,
    error: cadGenerations.error,
    rating: cadGenerations.rating,
    feedbackTags: cadGenerations.feedbackTags,
    feedbackNote: cadGenerations.feedbackNote,
    networksReport: cadGenerations.networksReport,
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
            .limit(THREAD_GEN_LIMIT)
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

  // The next three lookups each depend only on `rows` (via the id sets
  // below), not on each other's results — batch them into one
  // Promise.all instead of three sequential round trips.
  //
  // Live builds survive navigation: for every still-pending generation, find
  // its non-terminal job so the studio can REATTACH to the events stream on
  // load. The DB is the source of truth here — the old sessionStorage-only
  // resume forgot running jobs whenever the tab (or its storage) went away,
  // stranding a build that was still executing server-side behind a
  // "no printable model" empty state.
  const pendingGenIds = rows
    .filter((r) => r.status === "pending")
    .map((r) => r.id);

  // Reconstruct multi-part assemblies: each assembly generation links to a
  // Project bundling its part files, so an assembly survives reload/navigation
  // instead of collapsing to its primary part. Batch-load all parts at once.
  const projectIds = [
    ...new Set(rows.map((r) => r.projectId).filter((p): p is string => !!p)),
  ];

  // STEP presence for each turn's primary asset — batched so the studio can
  // render the "Download STEP" action at first paint without a per-button probe
  // (MTR-215). A stamped `stepStorageKey` is the same signal the download action
  // gates on server-side.
  const primaryAssetIds = [
    ...new Set(
      rows.map((r) => r.fileAssetId).filter((id): id is string => !!id)
    ),
  ];

  const [activeJobs, partRows, stepRows] = await Promise.all([
    pendingGenIds.length > 0
      ? withDbRetry(() =>
          db
            .select({
              id: cadJobs.id,
              generationId: cadJobs.generationId,
              createdAt: cadJobs.createdAt,
            })
            .from(cadJobs)
            .where(
              and(
                inArray(cadJobs.generationId, pendingGenIds),
                inArray(cadJobs.status, ["queued", "running", "awaiting_input"])
              )
            )
            .orderBy(desc(cadJobs.createdAt))
        )
      : Promise.resolve([]),
    projectIds.length > 0
      ? withDbRetry(() =>
          db
            .select({
              projectId: projectFiles.projectId,
              slug: projects.slug,
              name: files.name,
              fileAssetId: fileAssets.id,
              // STEP presence per part so the studio's action row is stable at
              // first paint for assemblies too (MTR-215).
              stepStorageKey: fileAssets.stepStorageKey,
            })
            .from(projectFiles)
            .innerJoin(projects, eq(projects.id, projectFiles.projectId))
            .innerJoin(files, eq(files.id, projectFiles.fileId))
            .innerJoin(fileAssets, eq(fileAssets.fileId, files.id))
            .where(inArray(projectFiles.projectId, projectIds))
            .orderBy(projectFiles.position)
        )
      : Promise.resolve([]),
    primaryAssetIds.length > 0
      ? withDbRetry(() =>
          db
            .select({ id: fileAssets.id, stepStorageKey: fileAssets.stepStorageKey })
            .from(fileAssets)
            .where(inArray(fileAssets.id, primaryAssetIds))
        )
      : Promise.resolve([]),
  ]);

  const activeJobByGen = new Map<string, string>();
  for (const j of activeJobs) {
    // Newest job wins per generation (rows arrive newest-first).
    if (!activeJobByGen.has(j.generationId)) {
      activeJobByGen.set(j.generationId, j.id);
    }
  }

  const partsByProject = new Map<
    string,
    {
      slug: string;
      parts: { name: string; fileAssetId: string; hasStep: boolean }[];
    }
  >();
  for (const pr of partRows) {
    const entry =
      partsByProject.get(pr.projectId) ?? { slug: pr.slug, parts: [] };
    // Part files are named "<assembly> — <part>"; show just the part.
    const name =
      pr.name && pr.name.includes(" — ")
        ? pr.name.split(" — ").slice(1).join(" — ")
        : pr.name ?? "part";
    entry.parts.push({
      name,
      fileAssetId: pr.fileAssetId,
      hasStep: !!pr.stepStorageKey,
    });
    partsByProject.set(pr.projectId, entry);
  }

  const assetsWithStep = new Set<string>();
  for (const s of stepRows) if (s.stepStorageKey) assetsWithStep.add(s.id);

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
      features: parseFeatures(r.features),
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
      // Isolation verdict (MTR-179) — persisted, so the badge survives reload.
      networksReport: r.networksReport ?? null,
      // Non-terminal job for a still-pending generation — the studio
      // reattaches to its events stream on load (live builds survive
      // navigation).
      activeJobId: activeJobByGen.get(r.id) ?? null,
      // STEP availability threaded so "Download STEP" renders at first paint
      // (no post-mount pop-in / row reflow, MTR-215).
      hasStep: r.fileAssetId ? assetsWithStep.has(r.fileAssetId) : false,
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
    features: m.features,
    error: m.error,
    rating: m.rating,
    feedbackTags: m.feedbackTags,
    feedbackNote: m.feedbackNote,
    parts: m.parts,
    projectSlug: m.projectSlug,
    remeshed: m.remeshed,
    networksReport: m.networksReport,
    hasStep: m.hasStep,
    parentGenerationId: m.parentGenerationId,
    activeJobId: m.activeJobId,
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

  return <TextToCadStudio initialThreads={initialThreads} />;
}
