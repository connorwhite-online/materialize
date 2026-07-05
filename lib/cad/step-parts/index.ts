/**
 * Off-the-shelf part sourcing orchestrator (MTR-200). ONE entry point,
 * `sourcePart`, with the miss discipline the step.parts policy asks for:
 * search before modeling placeholder geometry, a network failure is not a
 * no-match, and every miss is recorded so the caller falls back to the
 * documented envelope (knowledge/components.ts) — never a silent guess.
 *
 * Default source is the bd_warehouse standard-parts resolver (trusted
 * ISO/DIN geometry via constructor snippets — see ./bd-warehouse.ts; the
 * hosted catalog's STEP files have no documented redistribution license, so
 * the catalog is gated OFF; see ./types.ts). When `CAD_STEP_PARTS_ENABLED=
 * true`, the catalog is consulted first for real vendor geometry (boards,
 * connectors — parts bd_warehouse has no notion of), with the standard-parts
 * resolver as the offline/empty fallback.
 */
import {
  catalogEnabled,
  searchParts,
  downloadAndCacheStep,
  StepPartsNetworkError,
} from "./client";
import { resolveStandardPart } from "./bd-warehouse";
import type {
  PartSourceMiss,
  PartSourceResult,
  SourcedPart,
} from "./types";

export * from "./types";
export { catalogEnabled } from "./client";
export { resolveStandardPart } from "./bd-warehouse";

function miss(query: string, reason: PartSourceMiss["reason"], detail?: string): PartSourceResult {
  return { ok: false, miss: { query, reason, detail } };
}

/**
 * Source one named component. Catalog-first when enabled (real STEP, cached +
 * sha256-verified), else the bd_warehouse standard-parts resolver, else a
 * recorded miss. Never throws — transport failures become a `network-error`
 * miss (distinct from `no-match`) so a transient outage is retried, not
 * memorialized.
 */
export async function sourcePart(
  query: string,
  opts: { signal?: AbortSignal } = {}
): Promise<PartSourceResult> {
  const q = query.trim();
  if (!q) return miss(query, "no-match", "empty query");

  if (catalogEnabled()) {
    try {
      const records = await searchParts(q, { signal: opts.signal });
      if (records.length > 0) {
        const record = records[0];
        try {
          const cached = await downloadAndCacheStep(record, { signal: opts.signal });
          const part: SourcedPart = {
            query: q,
            kind: "catalog",
            partId: record.id,
            label: record.name ?? record.id,
            sha256: cached.sha256,
            cacheKey: cached.cacheKey,
            note:
              "Real vendor STEP (step.parts), sha256-verified + R2-cached. Import via the sidecar and derive mating frames from inspected geometry — the STEP origin is arbitrary.",
          };
          return { ok: true, part };
        } catch (err) {
          if (err instanceof StepPartsNetworkError) {
            return maybeLocal(q) ?? miss(q, "network-error", (err as Error).message);
          }
          if ((err as Error)?.name === "StepPartsChecksumError") {
            return maybeLocal(q) ?? miss(q, "checksum-mismatch", (err as Error).message);
          }
          throw err;
        }
      }
      // Catalog reachable but empty → try local, else genuine no-match.
      return maybeLocal(q) ?? miss(q, "no-match", "no catalog or local match");
    } catch (err) {
      if (err instanceof StepPartsNetworkError) {
        // Could not reach the catalog — a local hit still helps; otherwise this
        // is explicitly NOT a no-match.
        return maybeLocal(q) ?? miss(q, "network-error", (err as Error).message);
      }
      return maybeLocal(q) ?? miss(q, "no-match", (err as Error)?.message);
    }
  }

  // Catalog disabled (the default): standard-parts resolver only.
  return (
    maybeLocal(q) ??
    miss(q, "no-match", "catalog disabled; no match in the bd_warehouse standard-parts resolver")
  );
}

function maybeLocal(query: string): PartSourceResult | null {
  const local = resolveStandardPart(query);
  return local ? { ok: true, part: local } : null;
}

export interface BriefSourcing {
  sourced: SourcedPart[];
  misses: PartSourceMiss[];
}

/**
 * Source every named thing a brief references (components + screw interfaces),
 * de-duplicated. Best-effort: a failure to source anything is recorded as a
 * miss, never thrown — the harness proceeds with the components.ts envelope.
 */
export async function sourcePartsForBrief(
  brief: {
    components?: { name?: string }[];
    interfaces?: { type?: string; std?: string }[];
  } | null,
  opts: { signal?: AbortSignal } = {}
): Promise<BriefSourcing> {
  const sourced: SourcedPart[] = [];
  const misses: PartSourceMiss[] = [];
  if (!brief) return { sourced, misses };

  const queries = new Set<string>();
  for (const c of brief.components ?? []) {
    if (c.name?.trim()) queries.add(c.name.trim());
  }
  for (const i of brief.interfaces ?? []) {
    if (i.std?.trim()) queries.add(i.std.trim());
  }

  for (const query of queries) {
    const res = await sourcePart(query, opts);
    if (res.ok) sourced.push(res.part);
    else misses.push(res.miss);
  }
  return { sourced, misses };
}

/**
 * Prompt block describing the sourced parts (their envelopes) + honestly noting
 * the misses that fell back to documented envelopes. Empty when nothing was
 * sourced or missed. Appended to the generate prompt / handed to the agent.
 */
export function formatSourcedPartsForPrompt(s: BriefSourcing): string {
  if (s.sourced.length === 0 && s.misses.length === 0) return "";
  const lines: string[] = ["Off-the-shelf parts (MTR-200):"];
  for (const p of s.sourced) {
    const env = p.envelopeMm ? ` — envelope ${p.envelopeMm.join(" × ")} mm` : "";
    const geom =
      p.kind === "catalog"
        ? " (real vendor STEP cached; size cavities/cutouts from the imported geometry, not a box)"
        : p.kind === "bd_warehouse" && p.bdWarehouse
          ? ` — construct it, never hand-model it: \`${p.bdWarehouse.importLine}\` then \`${p.bdWarehouse.constructor}\``
          : p.kind === "local-fastener"
            ? " (documented envelope only — no bd_warehouse coverage for this one)"
            : "";
    lines.push(`- "${p.query}" → ${p.label}${env}${geom}`);
  }
  for (const m of s.misses) {
    // network-error is honest: we could not confirm, do not assume absence.
    const tail =
      m.reason === "network-error"
        ? "sourcing unavailable (network) — use the documented envelope for now"
        : "no catalog/local match — use the documented envelope";
    lines.push(`- "${m.query}" → ${tail}`);
  }
  return lines.join("\n");
}
