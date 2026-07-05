/**
 * Off-the-shelf part sourcing (MTR-200) — shared types. Pure, no server-only.
 *
 * PROVENANCE / LICENSE POSTURE (the check the issue said to do FIRST): the
 * step.parts catalog is MIT-tooled but the STEP *files* it serves carry NO
 * documented redistribution license, the API was unreachable for verification,
 * and it is a single-maintainer service. So the DEFAULT source is a LOCAL
 * fasteners library (dimensions are uncopyrightable facts, re-tabled in our own
 * values — same posture as knowledge/fasteners.ts). The hosted catalog client
 * exists and is R2-cached + sha256-verified, but is gated OFF
 * (`CAD_STEP_PARTS_ENABLED`) until a human confirms the license permits
 * redistribution in user-downloadable artifacts. Our R2 cache is the
 * availability mitigation for when it is turned on.
 */

/** A raw record from the step.parts catalog (api.step.parts/v1/parts). */
export interface StepPartRecord {
  id: string;
  name?: string;
  /** sha256 of the STEP bytes — verified on download. */
  sha256: string;
  byteSize: number;
  /** STEP download URL (may resolve to GitHub LFS). */
  stepUrl: string;
  tags?: string[];
  category?: string;
  family?: string;
  standard?: string;
}

/** Where a resolved part came from. */
export type PartSourceKind =
  | "catalog" // real vendor STEP from step.parts (gated on license confirmation)
  | "local-fastener" // our local fasteners library (the scoped-down default)
  | "envelope-fallback"; // documented box envelope (components.ts) — no real geometry

/** A successfully sourced part. */
export interface SourcedPart {
  /** The query that resolved to this part. */
  query: string;
  kind: PartSourceKind;
  /** Catalog id or local part id, when there is one. */
  partId?: string;
  label: string;
  /** sha256 of the cached STEP (catalog only). */
  sha256?: string;
  /** R2 object key of the cached STEP (catalog only). */
  cacheKey?: string;
  /**
   * Documented outer envelope (mm) — ALWAYS present, so cavities/cutouts can be
   * sized even when no real STEP geometry is available. Imported STEP origins
   * are arbitrary (step.parts' explicit warning), so callers derive mating
   * frames from inspected geometry, never from these numbers.
   */
  envelopeMm?: [number, number, number];
  note?: string;
}

/**
 * A recorded miss. Network failure is DISTINCT from no-match (step.parts'
 * policy: "a network failure is not a 'no match'") so a transient outage
 * doesn't get baked in as "this part doesn't exist."
 */
export interface PartSourceMiss {
  query: string;
  reason:
    | "no-match" // searched, genuinely nothing matched → envelope fallback
    | "network-error" // could not reach the catalog → NOT a no-match; retry later
    | "catalog-disabled" // catalog gated off; only local library was consulted
    | "checksum-mismatch"; // matched but the STEP failed sha256 → do not trust it
  detail?: string;
}

/** The result of a sourcing attempt: exactly one of part / miss. */
export type PartSourceResult =
  | { ok: true; part: SourcedPart }
  | { ok: false; miss: PartSourceMiss };
