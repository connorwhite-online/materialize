/**
 * Local fasteners library (MTR-200) — the scoped-down default source when the
 * step.parts catalog is gated off (its STEP files have no documented
 * redistribution license). Resolves common metric-fastener descriptions to a
 * documented envelope built from knowledge/fasteners.ts, so the harness can
 * size clearance holes, bosses, and counterbores against real numbers even
 * offline. Pure — no network, no server-only.
 *
 * This library returns ENVELOPES, not real STEP geometry (we ship no vendor
 * STEP). That is enough for cavity/cutout fitting; when true mating geometry is
 * needed, turning on the catalog (after a license check) upgrades these.
 */
import { METRIC_FASTENERS, type MetricFastener } from "../knowledge/fasteners";
import type { SourcedPart } from "./types";

/** Fastener families we recognize in a free-form description. */
const HEAD_TYPES: { re: RegExp; label: string; standard?: string }[] = [
  { re: /socket\s*head|cap\s*screw|shcs|iso\s*4762|din\s*912/i, label: "socket head cap screw", standard: "ISO 4762" },
  { re: /button\s*head|iso\s*7380/i, label: "button head screw", standard: "ISO 7380" },
  { re: /countersunk|flat\s*head|iso\s*10642|din\s*7991/i, label: "countersunk screw", standard: "ISO 10642" },
  { re: /grub|set\s*screw|iso\s*4026/i, label: "set screw", standard: "ISO 4026" },
  { re: /hex\s*nut|iso\s*4032|nut\b/i, label: "hex nut", standard: "ISO 4032" },
  { re: /washer|iso\s*7089/i, label: "washer", standard: "ISO 7089" },
  { re: /heat[-\s]*set|threaded\s*insert|insert\b/i, label: "heat-set insert" },
];

/**
 * Metric size token, e.g. "m3", "M2.5", "M3x12". The negative lookahead
 * `(?![\d.])` ends the size WITHOUT a trailing `\b` — a `\b` would reject
 * "M3x12" (no boundary between "3" and "x") — while still refusing "M30"
 * (would be M3 + 0) so only a real metric size matches. Optional "x12" length.
 */
const SIZE_RE = /\bm\s?(2\.5|2|3|4|5|6|8)(?![\d.])(?:\s*[x×]\s*(\d{1,3}))?/i;

/** Resolve a metric size token to a fasteners.ts row. */
function fastenerRow(sizeToken: string): MetricFastener | null {
  const key = `M${sizeToken}`.replace(".", "_");
  return METRIC_FASTENERS[key] ?? null;
}

/**
 * Try to resolve a free-form component description ("iso4762 socket head cap
 * screw M3x12", "M4 heat-set insert", "608 bearing") to a local part with a
 * documented envelope. Returns null when nothing in the local library matches
 * (the caller records a no-match and falls back to the components.ts envelope).
 */
export function resolveLocalFastener(query: string): SourcedPart | null {
  const sizeMatch = query.match(SIZE_RE);
  if (!sizeMatch) return null;
  const row = fastenerRow(sizeMatch[1]);
  if (!row) return null;
  const lengthMm = sizeMatch[2] ? Number(sizeMatch[2]) : undefined;

  const head = HEAD_TYPES.find((h) => h.re.test(query));
  // A bare "M3" with no recognizable fastener family is too ambiguous to model
  // as a specific part — only resolve when a family word is present, OR when a
  // length is given (an "M3x12" clearly denotes a screw).
  if (!head && lengthMm == null) return null;

  const label = head
    ? `${row.size}${lengthMm ? `×${lengthMm}` : ""} ${head.label}`
    : `${row.size}×${lengthMm} screw`;

  const envelopeMm = envelopeFor(row, head?.label, lengthMm);
  const parts = [
    `clearance hole ${row.clearanceHoleMm} mm`,
    `heat-set bore ${row.heatSetBoreMm} mm`,
  ];
  return {
    query,
    kind: "local-fastener",
    partId: localPartId(row.size, head?.label, lengthMm),
    label,
    envelopeMm,
    note: `${row.size} — ${parts.join(", ")}${head?.standard ? ` (${head.standard})` : ""}. Local library envelope, not vendor STEP.`,
  };
}

/** A stable id for a local fastener part (used in provenance + cache keys). */
export function localPartId(
  size: string,
  headLabel: string | undefined,
  lengthMm: number | undefined
): string {
  const head = (headLabel ?? "screw").replace(/\s+/g, "-");
  const len = lengthMm != null ? `x${lengthMm}` : "";
  return `local:${size.toLowerCase()}${len}-${head}`;
}

/** Envelope box (mm) for the fastener — head-dominated footprint × length. */
function envelopeFor(
  row: MetricFastener,
  headLabel: string | undefined,
  lengthMm: number | undefined
): [number, number, number] {
  // Nuts/washers/inserts have no shank length; screws stand `lengthMm` tall
  // plus their head height.
  const noShank = headLabel === "hex nut" || headLabel === "washer" || headLabel === "heat-set insert";
  const foot = row.headDiaMm;
  if (noShank) {
    const h =
      headLabel === "hex nut"
        ? row.headHeightMm + 1 // nut is thicker than a cap head; approximate
        : headLabel === "washer"
          ? 1.0
          : row.headHeightMm; // insert ~ head height tall
    return [foot, foot, Number(h.toFixed(2))];
  }
  const shank = lengthMm ?? 10;
  return [foot, foot, Number((row.headHeightMm + shank).toFixed(2))];
}
