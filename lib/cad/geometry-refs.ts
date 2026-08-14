import "server-only";

import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import { db } from "@/lib/db";
import { cadGenerations } from "@/lib/db/schema";
import { logError } from "@/lib/logger";
import { getObjectBytes } from "@/lib/storage";
import {
  MAX_GEOMETRY_REFS,
  resolveCaptureTier,
  SCAN_FILE_TYPES,
  type ProxyLevel,
  type ScanFileType,
} from "./scan-tiers";

/**
 * Geometry attached to a studio turn — the GEOMETRY sibling of
 * reference-images.ts, and deliberately its mirror image in structure so the
 * two behave the same way from a reader's point of view.
 *
 * Why this is one module and not a scan-specific one: a phone scan and a
 * user-uploaded STEP are the same input to the studio. Both are geometry the
 * user brings, both must persist to R2, both must be inherited by revisions
 * (or "make the lid taller" on turn 3 reaches a model that has forgotten what
 * it is building around), and both are reduced sidecar-side to something a CAD
 * kernel will accept. Only the reduction differs. Scan-to-CAD is the first
 * consumer; remix/edit (MTR-207) is the second and needs no new pipe.
 *
 * These do NOT become files/fileAssets rows. That would mean widening the
 * file_format pg enum and ACCEPTED_FORMATS, and dragging in the viewer,
 * fingerprinting, thumbnails and CraftCloud for something that is studio
 * input, not a library artifact.
 *
 * Everything here is best-effort by contract, exactly as reference-images.ts
 * is: a storage or DB hiccup must degrade to "this turn's own geometry", never
 * fail a generation.
 */

/** What cadGenerations.geometryRefs stores. */
export interface StoredGeometryRef {
  /** R2 key under `cad-geo/`. */
  key: string;
  /** Identifier the proxy is bound to in the sidecar namespace. */
  name: string;
  fileType: string;
  /** Original filename, for display. */
  label?: string;
  captureTier?: string;
  proxyLevel?: string;
  clearanceMm?: number;
  byteSize?: number;
}

/** What the generate route accepts per attachment (post-upload). */
export interface AttachedGeometry {
  key: string;
  fileType: string;
  label?: string;
  captureTier?: string;
}

/** One entry of the sidecar's `/run` `meshes` payload. */
export interface SidecarMesh {
  b64: string;
  fileType: string;
  proxyLevel: ProxyLevel;
  clearanceMm: number;
}

const MAX_LABEL_CHARS = 120;

/** R2 prefix owning one user's studio geometry. */
export function geometryKeyPrefix(userId: string): string {
  return `cad-geo/${userId}/`;
}

export function buildGeometryKey(userId: string, fileType: string): string {
  return `${geometryKeyPrefix(userId)}${nanoid()}.${fileType}`;
}

/**
 * A namespace identifier for the sidecar. Must be a Python identifier, since
 * generated code refers to it by name.
 */
function bindingName(index: number): string {
  return index === 0 ? "scan" : `scan${index + 1}`;
}

function isScanFileType(t: string): t is ScanFileType {
  return (SCAN_FILE_TYPES as readonly string[]).includes(t);
}

/**
 * Validate and normalize the attachments on a generate request.
 *
 * Ownership is enforced by KEY PREFIX rather than a DB lookup: the presign
 * route is the only thing that mints these keys and it stamps the caller's id
 * into the path, so a key outside the caller's own prefix was not issued to
 * them. Rejecting here keeps a forged key from ever reaching R2.
 */
export function sanitizeAttachedGeometry(
  raw: unknown,
  userId: string
): AttachedGeometry[] {
  if (!Array.isArray(raw)) return [];
  const prefix = geometryKeyPrefix(userId);
  const out: AttachedGeometry[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const { key, fileType, label, captureTier } = item as Record<string, unknown>;
    if (typeof key !== "string" || !key.startsWith(prefix)) continue;
    // No traversal out of the prefix, however the key was assembled.
    if (key.includes("..")) continue;
    if (typeof fileType !== "string" || !isScanFileType(fileType.toLowerCase())) {
      continue;
    }
    out.push({
      key,
      fileType: fileType.toLowerCase(),
      ...(typeof label === "string" ? { label: label.slice(0, MAX_LABEL_CHARS) } : {}),
      ...(typeof captureTier === "string" ? { captureTier } : {}),
    });
    if (out.length >= MAX_GEOMETRY_REFS) break;
  }
  return out;
}

/**
 * Resolve the geometry for one turn: freshly attached first, then the parent's
 * stored refs (revisions), capped. Persists the combined list on THIS row so
 * the next revision inherits it in turn — one hop covers the whole chain,
 * because the parent's list already folded in its own parent's.
 */
export async function resolveGeometryRefs(opts: {
  generationId: string;
  userId: string;
  parentGenerationId?: string | null;
  geometry?: AttachedGeometry[] | null;
}): Promise<StoredGeometryRef[]> {
  const fresh = (opts.geometry ?? []).slice(0, MAX_GEOMETRY_REFS);

  let inherited: StoredGeometryRef[] = [];
  if (opts.parentGenerationId) {
    try {
      const [parent] = await db
        .select({ geometryRefs: cadGenerations.geometryRefs })
        .from(cadGenerations)
        .where(eq(cadGenerations.id, opts.parentGenerationId))
        .limit(1);
      inherited = (parent?.geometryRefs ?? []).filter(
        (r): r is StoredGeometryRef =>
          !!r && typeof r.key === "string" && typeof r.fileType === "string"
      );
    } catch (err) {
      logError("resolveGeometryRefs.parent", err);
    }
  }

  const combined: StoredGeometryRef[] = [
    ...fresh.map((g) => {
      const tier = resolveCaptureTier(g.captureTier);
      return {
        key: g.key,
        // Placeholder — renamed below so bindings stay stable and unique.
        name: "scan",
        fileType: g.fileType,
        ...(g.label ? { label: g.label } : {}),
        captureTier: tier.id,
        proxyLevel: tier.proxyLevel,
        clearanceMm: tier.clearanceMm,
      } satisfies StoredGeometryRef;
    }),
    ...inherited,
  ]
    .filter(
      (ref, i, all) => all.findIndex((o) => o.key === ref.key) === i
    )
    .slice(0, MAX_GEOMETRY_REFS)
    .map((ref, i) => ({ ...ref, name: bindingName(i) }));

  if (combined.length > 0) {
    try {
      await db
        .update(cadGenerations)
        .set({ geometryRefs: combined, updatedAt: new Date() })
        .where(eq(cadGenerations.id, opts.generationId));
    } catch (err) {
      logError("resolveGeometryRefs.persist", err);
    }
  }
  return combined;
}

/**
 * Fetch the referenced objects and shape them into the sidecar's `meshes`
 * payload, keyed by the name the proxy will be bound to.
 *
 * A ref whose object cannot be read is DROPPED with a log rather than throwing.
 * The alternative — failing the whole generation — would turn one expired or
 * swept object into a dead thread, and the harness can still say something
 * useful about a prompt whose geometry went missing.
 */
export async function loadGeometryForRun(
  refs: StoredGeometryRef[]
): Promise<Record<string, SidecarMesh>> {
  const entries = await Promise.all(
    refs.map(async (ref) => {
      try {
        const bytes = await getObjectBytes(ref.key);
        if (!bytes?.length) return null;
        const tier = resolveCaptureTier(ref.captureTier);
        return [
          ref.name,
          {
            b64: Buffer.from(bytes).toString("base64"),
            fileType: ref.fileType,
            proxyLevel: (ref.proxyLevel as ProxyLevel) ?? tier.proxyLevel,
            clearanceMm: ref.clearanceMm ?? tier.clearanceMm,
          } satisfies SidecarMesh,
        ] as const;
      } catch (err) {
        logError("loadGeometryForRun.fetch", err);
        return null;
      }
    })
  );
  return Object.fromEntries(
    entries.filter((e): e is NonNullable<typeof e> => e !== null)
  );
}
