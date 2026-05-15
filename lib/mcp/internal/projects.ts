import "server-only";

/**
 * Agent-facing helpers for the project + BOM + circuit + photo
 * surface. Mirrors the web server actions in app/actions/projects.ts,
 * project-photos.ts, and circuits.ts but bypasses Clerk auth — the
 * MCP handler hands us the user id from the verified bearer token.
 *
 * Permission model is the same on both surfaces:
 *   - Project ownership: row's userId === auth user.
 *   - File bundling: agent must own every fileId they pass in.
 *   - Storage keys: must be under the user's `photos/<userId>/` or
 *     `circuits/<userId>/` prefix.
 */

import { and, count, desc, eq, inArray } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/lib/db";
import {
  files,
  projects,
  projectFiles,
  projectBomItems,
  projectCircuits,
  projectPhotos,
} from "@/lib/db/schema";
import { buildListingSlug } from "@/lib/filenames";
import { logError } from "@/lib/logger";
import { LICENSE_ENUM_VALUES, type LicenseId } from "@/lib/licenses";
import { bestEffortDeleteR2 } from "./files";

const MAX_BOM_ITEMS = 200;
const MAX_CAPTION_LENGTH = 500;
const MAX_REPO_URL = 500;

export interface ProjectMetadataInput {
  name?: string;
  description?: string | null;
  /** Price in cents. 0 = free. */
  priceCents?: number;
  license?: LicenseId;
  visibility?: "public" | "private";
  tags?: string[];
  /** Optional firmware / source repo URL — appears as a "View code"
   * button on the project page. */
  repoUrl?: string | null;
}

function normalizeProjectMeta(meta: ProjectMetadataInput | undefined): Partial<{
  name: string;
  description: string | null;
  price: number;
  license: LicenseId;
  visibility: "public" | "private";
  tags: string[];
  repoUrl: string | null;
  status: "draft" | "published";
}> {
  if (!meta) return {};
  const out: ReturnType<typeof normalizeProjectMeta> = {};
  if (typeof meta.name === "string" && meta.name.trim()) {
    out.name = meta.name.trim().slice(0, 200);
  }
  if (meta.description !== undefined) {
    out.description = meta.description ? meta.description.slice(0, 5000) : null;
  }
  if (typeof meta.priceCents === "number" && meta.priceCents >= 0) {
    out.price = Math.round(meta.priceCents);
  }
  if (
    meta.license &&
    (LICENSE_ENUM_VALUES as readonly string[]).includes(meta.license)
  ) {
    out.license = meta.license;
  }
  if (meta.visibility === "public" || meta.visibility === "private") {
    out.visibility = meta.visibility;
    out.status = meta.visibility === "public" ? "published" : "draft";
  }
  if (Array.isArray(meta.tags)) {
    out.tags = meta.tags
      .map((t) => String(t).trim().slice(0, 32))
      .filter(Boolean)
      .slice(0, 20);
  }
  if (meta.repoUrl !== undefined) {
    if (!meta.repoUrl) {
      out.repoUrl = null;
    } else {
      // Light validation — the URL must parse and look like http(s).
      // The web form does the same in zod.
      try {
        const u = new URL(meta.repoUrl);
        if (u.protocol === "http:" || u.protocol === "https:") {
          out.repoUrl = u.toString().slice(0, MAX_REPO_URL);
        }
      } catch {
        // ignore bad URLs silently — agent can pass null to clear
      }
    }
  }
  return out;
}

async function userOwnsAllFiles(
  userId: string,
  fileIds: string[]
): Promise<boolean> {
  if (fileIds.length === 0) return false;
  const owned = await db
    .select({ id: files.id })
    .from(files)
    .where(and(inArray(files.id, fileIds), eq(files.userId, userId)));
  return owned.length === fileIds.length;
}

export interface CreateProjectInput {
  userId: string;
  /** Files to bundle. Agent must own every one. At least 1. */
  fileIds: string[];
  /** Required — defaults aren't acceptable for project names. */
  name: string;
  description?: string | null;
  priceCents?: number;
  license?: LicenseId;
  visibility?: "public" | "private";
  tags?: string[];
  repoUrl?: string | null;
}

export interface CreateProjectResult {
  projectId: string;
  slug: string;
}

export async function createProjectForUser(
  input: CreateProjectInput
): Promise<CreateProjectResult | { error: string }> {
  if (!input.fileIds || input.fileIds.length === 0) {
    return { error: "fileIds: at least one file is required" };
  }
  if (input.fileIds.length > 50) {
    return { error: "fileIds: too many files (max 50)" };
  }
  if (!input.name || !input.name.trim()) {
    return { error: "name is required" };
  }
  const fileIds = Array.from(new Set(input.fileIds));
  if (!(await userOwnsAllFiles(input.userId, fileIds))) {
    return { error: "One or more files are not yours" };
  }
  try {
    const meta = normalizeProjectMeta({
      name: input.name,
      description: input.description,
      priceCents: input.priceCents,
      license: input.license,
      visibility: input.visibility,
      tags: input.tags,
      repoUrl: input.repoUrl,
    });
    const visibility = meta.visibility ?? "public";
    const status = meta.status ?? "published";
    const slug = buildListingSlug(meta.name ?? input.name, nanoid(6));

    const [project] = await db
      .insert(projects)
      .values({
        userId: input.userId,
        name: meta.name ?? input.name,
        slug,
        description: meta.description ?? null,
        price: meta.price ?? 0,
        license: meta.license ?? "cc_by",
        visibility,
        status,
        tags: meta.tags ?? null,
        repoUrl: meta.repoUrl ?? null,
      })
      .returning();

    await db.insert(projectFiles).values(
      fileIds.map((fileId, i) => ({
        projectId: project.id,
        fileId,
        position: i,
      }))
    );

    return { projectId: project.id, slug: project.slug };
  } catch (error) {
    logError("createProjectForUser", error);
    return { error: "Failed to create project" };
  }
}

export interface ProjectSummary {
  projectId: string;
  slug: string;
  name: string;
  description: string | null;
  visibility: string;
  status: string;
  priceCents: number;
  license: string;
  fileCount: number;
  repoUrl: string | null;
  createdAt: string;
}

export async function listProjectsForUser(
  userId: string,
  limit = 100
): Promise<ProjectSummary[]> {
  const rows = await db
    .select({
      id: projects.id,
      slug: projects.slug,
      name: projects.name,
      description: projects.description,
      visibility: projects.visibility,
      status: projects.status,
      price: projects.price,
      license: projects.license,
      repoUrl: projects.repoUrl,
      createdAt: projects.createdAt,
    })
    .from(projects)
    .where(eq(projects.userId, userId))
    .orderBy(desc(projects.createdAt))
    .limit(limit);

  if (rows.length === 0) return [];

  // Batch fetch file counts for all listed projects. Group the
  // aggregation on the DB side instead of pulling every
  // (projectId, fileId) row back — at N projects with M files
  // each that's the difference between N*M rows over the wire
  // and just N.
  const projectIds = rows.map((r) => r.id);
  const countRows = await db
    .select({
      projectId: projectFiles.projectId,
      count: count(projectFiles.fileId),
    })
    .from(projectFiles)
    .where(inArray(projectFiles.projectId, projectIds))
    .groupBy(projectFiles.projectId);
  const countByProject = new Map<string, number>(
    countRows.map((r) => [r.projectId, r.count])
  );

  return rows.map((r) => ({
    projectId: r.id,
    slug: r.slug,
    name: r.name,
    description: r.description,
    visibility: r.visibility,
    status: r.status,
    priceCents: r.price,
    license: r.license,
    fileCount: countByProject.get(r.id) ?? 0,
    repoUrl: r.repoUrl,
    createdAt: r.createdAt.toISOString(),
  }));
}

export interface ProjectDetail extends ProjectSummary {
  files: Array<{ fileId: string; slug: string; name: string; position: number }>;
  bom: Array<{
    id: string;
    name: string;
    quantity: number;
    unit: string | null;
    notes: string | null;
    sourceUrl: string | null;
  }>;
  circuits: Array<{
    id: string;
    kind: string;
    caption: string | null;
    sourceFilename: string | null;
    /** Same-origin proxy URL for the rendered preview, when applicable. */
    previewUrl: string | null;
    /** Same-origin source bytes URL, when applicable (kicad / fritzing). */
    sourceUrl: string | null;
    /** External URL for wokwi_url kind. */
    externalUrl: string | null;
  }>;
  coverPhotoId: string | null;
}

export async function getProjectForUser(params: {
  userId: string;
  projectId: string;
}): Promise<ProjectDetail | { error: string }> {
  const [row] = await db
    .select({
      id: projects.id,
      slug: projects.slug,
      name: projects.name,
      description: projects.description,
      visibility: projects.visibility,
      status: projects.status,
      price: projects.price,
      license: projects.license,
      repoUrl: projects.repoUrl,
      coverPhotoId: projects.coverPhotoId,
      createdAt: projects.createdAt,
      ownerId: projects.userId,
    })
    .from(projects)
    .where(eq(projects.id, params.projectId))
    .limit(1);
  if (!row || row.ownerId !== params.userId) {
    return { error: "Project not found" };
  }

  const [bundledFiles, bomItems, circuitRows] = await Promise.all([
    db
      .select({
        fileId: projectFiles.fileId,
        position: projectFiles.position,
        slug: files.slug,
        name: files.name,
      })
      .from(projectFiles)
      .innerJoin(files, eq(projectFiles.fileId, files.id))
      .where(eq(projectFiles.projectId, row.id)),
    db
      .select()
      .from(projectBomItems)
      .where(eq(projectBomItems.projectId, row.id)),
    db
      .select()
      .from(projectCircuits)
      .where(eq(projectCircuits.projectId, row.id)),
  ]);

  return {
    projectId: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    visibility: row.visibility,
    status: row.status,
    priceCents: row.price,
    license: row.license,
    fileCount: bundledFiles.length,
    repoUrl: row.repoUrl,
    coverPhotoId: row.coverPhotoId,
    createdAt: row.createdAt.toISOString(),
    files: bundledFiles
      .map((f) => ({
        fileId: f.fileId,
        slug: f.slug,
        name: f.name,
        position: f.position,
      }))
      .sort((a, b) => a.position - b.position),
    bom: bomItems.map((b) => ({
      id: b.id,
      name: b.name,
      quantity: b.quantity,
      unit: b.unit,
      notes: b.notes,
      sourceUrl: b.sourceUrl,
    })),
    circuits: circuitRows.map((c) => ({
      id: c.id,
      kind: c.kind,
      caption: c.caption,
      sourceFilename: c.originalFilename,
      previewUrl: c.previewStorageKey ? `/api/circuits/${c.id}/preview` : null,
      sourceUrl: c.sourceStorageKey ? `/api/circuits/${c.id}/source` : null,
      externalUrl: c.externalUrl,
    })),
  };
}

export async function updateProjectForUser(params: {
  userId: string;
  projectId: string;
  metadata: ProjectMetadataInput;
}): Promise<{ projectId: string; slug: string } | { error: string }> {
  const [row] = await db
    .select({ id: projects.id, userId: projects.userId, slug: projects.slug })
    .from(projects)
    .where(eq(projects.id, params.projectId))
    .limit(1);
  if (!row || row.userId !== params.userId) {
    return { error: "Project not found" };
  }
  const meta = normalizeProjectMeta(params.metadata);
  if (Object.keys(meta).length === 0) {
    return { projectId: row.id, slug: row.slug };
  }
  await db.update(projects).set(meta).where(eq(projects.id, row.id));
  return { projectId: row.id, slug: row.slug };
}

export async function deleteProjectForUser(params: {
  userId: string;
  projectId: string;
}): Promise<{ ok: true } | { error: string }> {
  const [row] = await db
    .select({ id: projects.id, userId: projects.userId })
    .from(projects)
    .where(eq(projects.id, params.projectId))
    .limit(1);
  if (!row || row.userId !== params.userId) {
    return { error: "Project not found" };
  }
  await db.delete(projects).where(eq(projects.id, row.id));
  return { ok: true };
}

/* -------------------- BOM -------------------- */

export interface BomItemInput {
  name: string;
  quantity: number;
  unit?: string | null;
  notes?: string | null;
  sourceUrl?: string | null;
}

/**
 * Replace the entire BOM for a project. Mirrors the web editor's
 * "bulk replace" pattern (drop all, re-insert). Pass an empty array
 * to clear the BOM entirely.
 */
export async function setProjectBomForUser(params: {
  userId: string;
  projectId: string;
  items: BomItemInput[];
}): Promise<{ count: number } | { error: string }> {
  const [row] = await db
    .select({ id: projects.id, userId: projects.userId })
    .from(projects)
    .where(eq(projects.id, params.projectId))
    .limit(1);
  if (!row || row.userId !== params.userId) {
    return { error: "Project not found" };
  }
  if (params.items.length > MAX_BOM_ITEMS) {
    return { error: `BOM cannot exceed ${MAX_BOM_ITEMS} items` };
  }
  // Validate each row before touching the DB so a bad input doesn't
  // leave the BOM half-cleared.
  for (const it of params.items) {
    if (!it.name || !it.name.trim()) {
      return { error: "Every BOM item needs a name" };
    }
    if (typeof it.quantity !== "number" || it.quantity <= 0) {
      return { error: `BOM "${it.name}": quantity must be a positive number` };
    }
  }

  await db.delete(projectBomItems).where(eq(projectBomItems.projectId, row.id));
  if (params.items.length > 0) {
    await db.insert(projectBomItems).values(
      params.items.map((it, i) => ({
        projectId: row.id,
        name: it.name.trim().slice(0, 200),
        quantity: it.quantity,
        unit: it.unit?.trim().slice(0, 32) || null,
        notes: it.notes?.trim().slice(0, 500) || null,
        sourceUrl: it.sourceUrl?.trim().slice(0, 500) || null,
        sortOrder: i,
      }))
    );
  }
  return { count: params.items.length };
}

/* -------------------- Circuits -------------------- */

async function ownsProject(userId: string, projectId: string) {
  const [row] = await db
    .select({ id: projects.id, userId: projects.userId, slug: projects.slug })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  return row && row.userId === userId ? row : null;
}

async function nextCircuitSortOrder(projectId: string) {
  const rows = await db
    .select({ sortOrder: projectCircuits.sortOrder })
    .from(projectCircuits)
    .where(eq(projectCircuits.projectId, projectId));
  return rows.reduce((max, e) => Math.max(max, e.sortOrder), -1) + 1;
}

export async function addProjectCircuitImageForUser(params: {
  userId: string;
  projectId: string;
  storageKey: string;
  originalFilename?: string;
  caption?: string;
}): Promise<{ circuitId: string } | { error: string }> {
  if (!params.storageKey.startsWith(`circuits/${params.userId}/`)) {
    return { error: "Storage key does not match this user's circuits prefix" };
  }
  const project = await ownsProject(params.userId, params.projectId);
  if (!project) return { error: "Project not found" };

  const sortOrder = await nextCircuitSortOrder(project.id);
  const trimmedCaption = params.caption?.trim().slice(0, MAX_CAPTION_LENGTH);

  const [row] = await db
    .insert(projectCircuits)
    .values({
      projectId: project.id,
      kind: "image",
      sourceStorageKey: params.storageKey,
      previewStorageKey: params.storageKey,
      originalFilename: params.originalFilename ?? null,
      caption: trimmedCaption || null,
      sortOrder,
    })
    .returning();
  return { circuitId: row.id };
}

export async function addProjectCircuitKicadForUser(params: {
  userId: string;
  projectId: string;
  storageKey: string;
  /** "kicad_sch" for schematics, "kicad_pcb" for boards. */
  kind: "kicad_sch" | "kicad_pcb";
  originalFilename: string;
  caption?: string;
}): Promise<{ circuitId: string } | { error: string }> {
  if (!params.storageKey.startsWith(`circuits/${params.userId}/`)) {
    return { error: "Storage key does not match this user's circuits prefix" };
  }
  if (params.kind !== "kicad_sch" && params.kind !== "kicad_pcb") {
    return { error: "Invalid kind" };
  }
  const project = await ownsProject(params.userId, params.projectId);
  if (!project) return { error: "Project not found" };

  const sortOrder = await nextCircuitSortOrder(project.id);
  const trimmedCaption = params.caption?.trim().slice(0, MAX_CAPTION_LENGTH);

  const [row] = await db
    .insert(projectCircuits)
    .values({
      projectId: project.id,
      kind: params.kind,
      sourceStorageKey: params.storageKey,
      previewStorageKey: null,
      originalFilename: params.originalFilename,
      caption: trimmedCaption || null,
      sortOrder,
    })
    .returning();
  return { circuitId: row.id };
}

export async function addProjectCircuitWokwiForUser(params: {
  userId: string;
  projectId: string;
  url: string;
  caption?: string;
}): Promise<{ circuitId: string } | { error: string }> {
  // Canonicalize the URL — same logic as the web action.
  let parsed: URL;
  try {
    parsed = new URL(params.url.trim());
  } catch {
    return { error: "Paste a Wokwi project URL (wokwi.com/projects/…)" };
  }
  if (parsed.hostname !== "wokwi.com" && parsed.hostname !== "www.wokwi.com") {
    return { error: "Not a Wokwi URL" };
  }
  parsed.search = "";
  parsed.hash = "";
  parsed.hostname = "wokwi.com";
  const normalized = parsed.toString();

  const project = await ownsProject(params.userId, params.projectId);
  if (!project) return { error: "Project not found" };

  const sortOrder = await nextCircuitSortOrder(project.id);
  const trimmedCaption = params.caption?.trim().slice(0, MAX_CAPTION_LENGTH);

  const [row] = await db
    .insert(projectCircuits)
    .values({
      projectId: project.id,
      kind: "wokwi_url",
      externalUrl: normalized,
      caption: trimmedCaption || null,
      sortOrder,
    })
    .returning();
  return { circuitId: row.id };
}

export async function deleteProjectCircuitForUser(params: {
  userId: string;
  circuitId: string;
}): Promise<{ ok: true } | { error: string }> {
  const [row] = await db
    .select({
      id: projectCircuits.id,
      sourceStorageKey: projectCircuits.sourceStorageKey,
      previewStorageKey: projectCircuits.previewStorageKey,
      ownerId: projects.userId,
    })
    .from(projectCircuits)
    .innerJoin(projects, eq(projectCircuits.projectId, projects.id))
    .where(eq(projectCircuits.id, params.circuitId))
    .limit(1);
  if (!row || row.ownerId !== params.userId) {
    return { error: "Diagram not found" };
  }
  const keys = new Set<string>();
  if (row.sourceStorageKey) keys.add(row.sourceStorageKey);
  if (row.previewStorageKey) keys.add(row.previewStorageKey);
  for (const key of keys) await bestEffortDeleteR2(key);
  await db
    .delete(projectCircuits)
    .where(eq(projectCircuits.id, params.circuitId));
  return { ok: true };
}

/* -------------------- Photos -------------------- */

export async function addProjectPhotoForUser(params: {
  userId: string;
  projectId: string;
  storageKey: string;
  caption?: string;
}): Promise<{ photoId: string } | { error: string }> {
  if (!params.storageKey.startsWith(`photos/${params.userId}/`)) {
    return { error: "Storage key does not match this user's photos prefix" };
  }
  const project = await ownsProject(params.userId, params.projectId);
  if (!project) return { error: "Project not found" };

  const existing = await db
    .select({ sortOrder: projectPhotos.sortOrder })
    .from(projectPhotos)
    .where(eq(projectPhotos.projectId, project.id));
  const maxOrder = existing.reduce(
    (max, e) => Math.max(max, e.sortOrder),
    -1
  );

  const trimmedCaption = params.caption?.trim().slice(0, MAX_CAPTION_LENGTH);

  const [photo] = await db
    .insert(projectPhotos)
    .values({
      projectId: project.id,
      userId: params.userId,
      storageKey: params.storageKey,
      caption: trimmedCaption || null,
      sortOrder: maxOrder + 1,
      kind: "creator",
    })
    .returning();
  return { photoId: photo.id };
}

export async function setProjectCoverPhotoForUser(params: {
  userId: string;
  projectId: string;
  photoId: string | null;
}): Promise<{ ok: true } | { error: string }> {
  const project = await ownsProject(params.userId, params.projectId);
  if (!project) return { error: "Project not found" };
  if (params.photoId !== null) {
    const [photo] = await db
      .select({
        id: projectPhotos.id,
        projectId: projectPhotos.projectId,
        kind: projectPhotos.kind,
      })
      .from(projectPhotos)
      .where(eq(projectPhotos.id, params.photoId))
      .limit(1);
    if (
      !photo ||
      photo.projectId !== params.projectId ||
      photo.kind !== "creator"
    ) {
      return { error: "Photo doesn't belong to this project" };
    }
  }
  await db
    .update(projects)
    .set({ coverPhotoId: params.photoId })
    .where(eq(projects.id, project.id));
  return { ok: true };
}

