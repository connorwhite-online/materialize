/**
 * step.parts hosted-catalog client (MTR-200). Talks to api.step.parts, verifies
 * the sha256 the catalog advertises on every record, and caches the STEP bytes
 * in R2 keyed by part id + hash so we never hotlink at generation time (their
 * catalog is versioned; the cache is also our single-maintainer availability
 * mitigation).
 *
 * GATED OFF by default. The catalog's STEP files carry no documented
 * redistribution license (see ./types.ts) so this path only runs when
 * `CAD_STEP_PARTS_ENABLED === "true"`, set by a human who has confirmed the
 * license. `catalogEnabled()` is the single gate.
 *
 * NETWORK vs NO-MATCH: fetch/transport failures throw `StepPartsNetworkError`
 * so the caller records a distinct "network-error" miss — a transient outage is
 * never a "no match" (step.parts' explicit policy).
 */
import { createHash } from "node:crypto";

import { objectExists, putObject } from "@/lib/storage";
import type { StepPartRecord } from "./types";

const DEFAULT_BASE = "https://api.step.parts/v1";
/** Cap per their docs (pageSize ≤ 500); we only need a few candidates. */
const DEFAULT_PAGE_SIZE = 20;

export function catalogEnabled(): boolean {
  return process.env.CAD_STEP_PARTS_ENABLED === "true";
}

function baseUrl(): string {
  return process.env.CAD_STEP_PARTS_URL || DEFAULT_BASE;
}

/** Transport/HTTP failure reaching the catalog — NOT a no-match. */
export class StepPartsNetworkError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "StepPartsNetworkError";
  }
}

/** R2 key for a cached catalog STEP — id + hash so a re-version can't collide. */
export function stepCacheKey(id: string, sha256: string): string {
  const safeId = id.replace(/[^a-zA-Z0-9._-]+/g, "_");
  return `cad-parts/step-parts/${safeId}/${sha256}.step`;
}

async function getJson(path: string, signal?: AbortSignal): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(`${baseUrl()}${path}`, {
      headers: { accept: "application/json" },
      signal,
    });
  } catch (err) {
    throw new StepPartsNetworkError(`step.parts unreachable: ${(err as Error)?.message ?? err}`, {
      cause: err,
    });
  }
  if (!res.ok) {
    // 5xx / 429 are transport-ish (retryable); 404 on search is an empty result.
    if (res.status >= 500 || res.status === 429) {
      throw new StepPartsNetworkError(`step.parts ${res.status}`);
    }
    if (res.status === 404) return null;
    throw new StepPartsNetworkError(`step.parts ${res.status}`);
  }
  try {
    return await res.json();
  } catch (err) {
    throw new StepPartsNetworkError("step.parts returned invalid JSON", { cause: err });
  }
}

function coerceRecord(raw: unknown): StepPartRecord | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const id = typeof r.id === "string" ? r.id : null;
  const sha256 = typeof r.sha256 === "string" ? r.sha256 : null;
  const stepUrl =
    typeof r.stepUrl === "string" ? r.stepUrl : typeof r.step_url === "string" ? r.step_url : null;
  const byteSize =
    typeof r.byteSize === "number" ? r.byteSize : typeof r.byte_size === "number" ? r.byte_size : 0;
  if (!id || !sha256 || !stepUrl) return null;
  return {
    id,
    name: typeof r.name === "string" ? r.name : undefined,
    sha256,
    byteSize,
    stepUrl,
    tags: Array.isArray(r.tags) ? (r.tags.filter((t) => typeof t === "string") as string[]) : undefined,
    category: typeof r.category === "string" ? r.category : undefined,
    family: typeof r.family === "string" ? r.family : undefined,
    standard: typeof r.standard === "string" ? r.standard : undefined,
  };
}

/**
 * Search the catalog. Tokens are ANDed by the API; we pass the query through.
 * Returns [] on a genuine empty result; throws StepPartsNetworkError on a
 * transport failure so the caller can tell the two apart.
 */
export async function searchParts(
  query: string,
  opts: { pageSize?: number; signal?: AbortSignal } = {}
): Promise<StepPartRecord[]> {
  const pageSize = Math.min(opts.pageSize ?? DEFAULT_PAGE_SIZE, 500);
  const qs = new URLSearchParams({ q: query, pageSize: String(pageSize) });
  const json = await getJson(`/parts?${qs}`, opts.signal);
  if (json == null) return [];
  const list = Array.isArray(json)
    ? json
    : Array.isArray((json as { parts?: unknown }).parts)
      ? (json as { parts: unknown[] }).parts
      : [];
  return list.map(coerceRecord).filter((r): r is StepPartRecord => r !== null);
}

/** Fetch one record by id, or null when the catalog has no such part. */
export async function fetchPartRecord(
  id: string,
  signal?: AbortSignal
): Promise<StepPartRecord | null> {
  const json = await getJson(`/parts/${encodeURIComponent(id)}`, signal);
  return json == null ? null : coerceRecord(json);
}

export interface CachedStep {
  cacheKey: string;
  sha256: string;
  byteSize: number;
  /** True when the bytes were already in R2 (no re-download). */
  fromCache: boolean;
}

/**
 * Download a record's STEP, VERIFY its sha256, and cache it in R2. Reuses the
 * cached object when present (keyed by id+hash). Throws:
 *  - StepPartsNetworkError on a download transport failure, and
 *  - a checksum Error (name "StepPartsChecksumError") when the bytes don't
 *    match the advertised hash (do not trust the file).
 */
export async function downloadAndCacheStep(
  record: StepPartRecord,
  opts: { signal?: AbortSignal } = {}
): Promise<CachedStep> {
  const cacheKey = stepCacheKey(record.id, record.sha256);
  const existing = await objectExists(cacheKey);
  if (existing.exists) {
    return { cacheKey, sha256: record.sha256, byteSize: existing.sizeBytes, fromCache: true };
  }

  let res: Response;
  try {
    res = await fetch(record.stepUrl, { signal: opts.signal });
  } catch (err) {
    throw new StepPartsNetworkError(`STEP download failed: ${(err as Error)?.message ?? err}`, {
      cause: err,
    });
  }
  if (!res.ok) throw new StepPartsNetworkError(`STEP download ${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer());

  const digest = createHash("sha256").update(bytes).digest("hex");
  if (digest.toLowerCase() !== record.sha256.toLowerCase()) {
    const err = new Error(
      `sha256 mismatch for ${record.id}: got ${digest}, expected ${record.sha256}`
    );
    err.name = "StepPartsChecksumError";
    throw err;
  }

  await putObject(cacheKey, bytes, "application/step");
  return { cacheKey, sha256: record.sha256, byteSize: bytes.byteLength, fromCache: false };
}
