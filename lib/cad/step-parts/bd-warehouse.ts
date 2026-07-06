/**
 * bd_warehouse standard-parts resolver (MTR-200) — the default source for
 * off-the-shelf parts. Replaces the hand-rolled local fasteners library:
 * instead of envelope-only boxes, aliases and standard codes ("m3x12 shcs",
 * "iso4762_m3x12", "M4 hex nut", "608zz") resolve to bd_warehouse CONSTRUCTOR
 * SNIPPETS (Apache-2.0, by the build123d author) that the sidecar executes to
 * produce real standards geometry. Dimensions are trusted upstream (published
 * ISO/DIN/vendor tables); every emitted constructor shape is mirrored in
 * cad-runner/tests/test_bd_warehouse_smoke.py, the one-Docker-run gate — this
 * env cannot execute OCP, so nothing here claims the geometry ran.
 *
 * Envelope dims (from knowledge/fasteners.ts, uncopyrightable facts) still
 * ride along on every part so cavities/cutouts can be sized without executing
 * anything. The heat-set-insert BOSS recipe (bore + >=2 mm wall) also stays
 * ours — bd_warehouse models the insert, not the printed boss around it.
 *
 * Pure — no network, no server-only.
 */
import { METRIC_FASTENERS, type MetricFastener } from "../knowledge/fasteners";
import type { SourcedPart } from "./types";

/**
 * Size/pitch strings bd_warehouse keys its fastener tables by ("M3-0.5").
 * Most tables trim integer pitches ("M6-1"); the metric set-screw table keeps
 * one decimal ("M6-1.0") — both verified against the 0.2.0 wheel's CSVs.
 */
function bdwSize(row: MetricFastener, pitchDecimal = false): string {
  const p = String(row.pitchMm);
  const pitch = pitchDecimal && !p.includes(".") ? `${p}.0` : p;
  return `${row.size}-${pitch}`;
}

interface FastenerFamily {
  re: RegExp;
  label: string;
  standard?: string;
  /** bd_warehouse.fastener class; undefined = no coverage (envelope only). */
  className?: string;
  /** Explicit fastener_type for the snippet (matches the class default). */
  fastenerType?: string;
  shape: "screw" | "nut" | "washer" | "insert";
  /** Table keeps ".0" on integer pitches (set screws: "M6-1.0"). */
  pitchDecimal?: boolean;
  /** Sizes (of our M2-M8 range) MISSING from this family's table. */
  unsupportedSizes?: ReadonlySet<string>;
}

/**
 * Fastener families we recognize in a free-form description or standard code
 * (queries are normalized so "iso4762_m3x12" matches the same as "iso 4762
 * m3x12"). Order matters: "hex nut" must win before "hex head".
 */
const FAMILIES: FastenerFamily[] = [
  { re: /socket\s*head|cap\s*screw|shcs|iso\s*4762|din\s*912/i, label: "socket head cap screw", standard: "ISO 4762", className: "SocketHeadCapScrew", fastenerType: "iso4762", shape: "screw" },
  { re: /button\s*head|iso\s*7380/i, label: "button head screw", standard: "ISO 7380-1", className: "ButtonHeadScrew", fastenerType: "iso7380_1", shape: "screw", unsupportedSizes: new Set(["M2", "M2.5"]) },
  { re: /countersunk|counter\s*sunk|flat\s*head|iso\s*10642|din\s*7991/i, label: "countersunk screw", standard: "ISO 10642", className: "CounterSunkScrew", fastenerType: "iso10642", shape: "screw" },
  { re: /grub|set\s*screw|iso\s*4026/i, label: "set screw", standard: "ISO 4026", className: "SetScrew", fastenerType: "iso4026", shape: "screw", pitchDecimal: true },
  { re: /hex\s*nut|iso\s*4032|nut\b/i, label: "hex nut", standard: "ISO 4032", className: "HexNut", fastenerType: "iso4032", shape: "nut" },
  { re: /hex\s*(head|bolt)|iso\s*4014|iso\s*4017|din\s*931/i, label: "hex head bolt", standard: "ISO 4014", className: "HexHeadScrew", fastenerType: "iso4014", shape: "screw" },
  { re: /washer|iso\s*7089/i, label: "washer", standard: "ISO 7089", className: "PlainWasher", fastenerType: "iso7089", shape: "washer" },
  // HeatSetNut only tables M2-M5 (McMaster-Carr "Standard" series); larger
  // inserts resolve envelope-only. className is decided per-size below.
  { re: /heat[-\s]*set|threaded\s*insert|insert\b/i, label: "heat-set insert", shape: "insert" },
];

/** Heat-set insert sizes bd_warehouse's HeatSetNut actually tables. */
const HEATSET_SIZES = new Set(["M2", "M3", "M4", "M5"]);

/**
 * Metric size token, e.g. "m3", "M2.5", "M3x12". The negative lookahead
 * `(?![\d.])` ends the size WITHOUT a trailing `\b` — a `\b` would reject
 * "M3x12" (no boundary between "3" and "x") — while still refusing "M30"
 * (would be M3 + 0) so only a real metric size matches. Optional "x12" length.
 */
const SIZE_RE = /\bm\s?(2\.5|2|3|4|5|6|8)(?![\d.])(?:\s*[x×]\s*(\d{1,3}))?/i;

/**
 * Deep-groove ball bearings by common designation. Size strings are the
 * bore-OD-width keys bd_warehouse's SKF-sourced tables use; `capped` = the
 * shielded/sealed (ZZ / 2RS) variant exists in the capped table too. Verified
 * against the 0.2.0 wheel's CSV data.
 */
const BEARINGS: Record<
  string,
  { size: string; boreMm: number; odMm: number; widthMm: number; capped: boolean }
> = {
  "623": { size: "M3-10-4", boreMm: 3, odMm: 10, widthMm: 4, capped: true },
  "624": { size: "M4-13-5", boreMm: 4, odMm: 13, widthMm: 5, capped: true },
  "625": { size: "M5-16-5", boreMm: 5, odMm: 16, widthMm: 5, capped: true },
  "626": { size: "M6-19-6", boreMm: 6, odMm: 19, widthMm: 6, capped: true },
  "608": { size: "M8-22-7", boreMm: 8, odMm: 22, widthMm: 7, capped: true },
  "6000": { size: "M10-26-8", boreMm: 10, odMm: 26, widthMm: 8, capped: false },
};

const BEARING_RE = /\b(608|62[3-6]|6000)\s*-?\s*(zz|2z|z|2rs|rs)?\b/i;

/** Resolve a metric size token to a fasteners.ts row. */
function fastenerRow(sizeToken: string): MetricFastener | null {
  const key = `M${sizeToken}`.replace(".", "_");
  return METRIC_FASTENERS[key] ?? null;
}

/**
 * Try to resolve a free-form component description or standard code to a
 * bd_warehouse constructor snippet (with an envelope for no-exec sizing), or —
 * for standard parts bd_warehouse doesn't table (e.g. M6/M8 heat-set inserts)
 * — a documented envelope. Returns null when nothing matches (the caller
 * records a no-match and falls back to the components.ts envelope).
 */
export function resolveStandardPart(query: string): SourcedPart | null {
  // Standard codes arrive underscore-joined ("iso4762_m3x12", "608zz").
  const q = query.replace(/[_/]+/g, " ").trim();
  return resolveBearing(query, q) ?? resolveFastener(query, q);
}

function resolveFastener(query: string, q: string): SourcedPart | null {
  const sizeMatch = q.match(SIZE_RE);
  if (!sizeMatch) return null;
  const row = fastenerRow(sizeMatch[1]);
  if (!row) return null;
  const lengthMm = sizeMatch[2] ? Number(sizeMatch[2]) : undefined;

  const family = FAMILIES.find((f) => f.re.test(q));
  // A bare "M3" with no recognizable fastener family is too ambiguous to model
  // as a specific part — only resolve when a family word is present, OR when a
  // length is given (an "M3x12" clearly denotes a screw; default it to SHCS,
  // the 3D-printing workhorse).
  if (!family && lengthMm == null) return null;
  const fam = family ?? FAMILIES[0];

  const label = `${row.size}${lengthMm ? `×${lengthMm}` : ""} ${fam.label}`;
  const envelopeMm = envelopeFor(row, fam.shape, lengthMm);
  const dims = [
    `clearance hole ${row.clearanceHoleMm} mm`,
    `heat-set bore ${row.heatSetBoreMm} mm`,
  ];

  // Constructor snippet, when bd_warehouse tables this family+size.
  let bdWarehouse: SourcedPart["bdWarehouse"];
  let extraNote = "";
  if (fam.shape === "insert") {
    if (HEATSET_SIZES.has(row.size)) {
      bdWarehouse = {
        importLine: "from bd_warehouse.fastener import HeatSetNut",
        constructor: `HeatSetNut(size="${bdwSize(row)}-Standard", fastener_type="McMaster-Carr")`,
      };
    } else {
      extraNote = ` bd_warehouse tables heat-set inserts M2-M5 only — model the ${row.size} bore from these numbers.`;
    }
    extraNote += ` Boss recipe (ours): bore ${row.heatSetBoreMm} mm, keep >=2 mm wall around the insert.`;
  } else if (fam.className && !fam.unsupportedSizes?.has(row.size)) {
    const size = bdwSize(row, fam.pitchDecimal);
    const args =
      fam.shape === "washer"
        ? `size="${row.size}", fastener_type="${fam.fastenerType}"`
        : fam.shape === "nut"
          ? `size="${size}", fastener_type="${fam.fastenerType}"`
          : `size="${size}", length=${lengthMm ?? 10}, fastener_type="${fam.fastenerType}"`;
    bdWarehouse = {
      importLine: `from bd_warehouse.fastener import ${fam.className}`,
      constructor: `${fam.className}(${args})`,
    };
    if (fam.shape === "screw" && lengthMm == null) {
      extraNote = " Length was not specified — 10 mm assumed; set the real length.";
    }
  } else if (fam.className) {
    extraNote = ` bd_warehouse's ${fam.label} table has no ${row.size} — model from these numbers.`;
  }

  return {
    query,
    kind: bdWarehouse ? "bd_warehouse" : "local-fastener",
    partId: standardPartId(row.size, fam.label, lengthMm),
    label,
    envelopeMm,
    bdWarehouse,
    note:
      `${row.size} — ${dims.join(", ")}${fam.standard ? ` (${fam.standard})` : ""}.` +
      (bdWarehouse
        ? ` Construct with bd_warehouse (trusted ISO/DIN tables), do not hand-model it.${extraNote}`
        : ` Documented envelope only — no bd_warehouse coverage.${extraNote}`),
  };
}

function resolveBearing(query: string, q: string): SourcedPart | null {
  const m = q.match(BEARING_RE);
  if (!m) return null;
  const suffix = m[2]?.toLowerCase();
  // A bare designation ("625") is just a number unless the query says bearing
  // or carries a ZZ/2RS-style suffix ("608zz" is unambiguous).
  if (!suffix && !/bearing/i.test(q)) return null;
  const spec = BEARINGS[m[1]];
  if (!spec) return null;

  const wantCapped = suffix != null;
  const capped = wantCapped && spec.capped;
  const className = capped
    ? "SingleRowCappedDeepGrooveBallBearing"
    : "SingleRowDeepGrooveBallBearing";
  const designation = `${m[1]}${suffix ? suffix.toUpperCase() : ""}`;

  return {
    query,
    kind: "bd_warehouse",
    partId: `bdw:bearing-${designation.toLowerCase()}`,
    label: `${designation} deep groove ball bearing (${spec.boreMm}×${spec.odMm}×${spec.widthMm} mm)`,
    envelopeMm: [spec.odMm, spec.odMm, spec.widthMm],
    bdWarehouse: {
      importLine: `from bd_warehouse.bearing import ${className}`,
      constructor: `${className}(size="${spec.size}", bearing_type="SKT")`,
    },
    note:
      `Bore ${spec.boreMm} mm, OD ${spec.odMm} mm (light press fit), width ${spec.widthMm} mm. ` +
      `Construct with bd_warehouse (SKF tables), do not hand-model it.` +
      (wantCapped && !spec.capped
        ? " Capped variant not tabled for this size — open bearing modeled; the envelope is identical."
        : ""),
  };
}

/** A stable id for a resolved standard part (used in provenance + dedupe). */
export function standardPartId(
  size: string,
  familyLabel: string,
  lengthMm: number | undefined
): string {
  const fam = familyLabel.replace(/\s+/g, "-");
  const len = lengthMm != null ? `x${lengthMm}` : "";
  return `bdw:${size.toLowerCase()}${len}-${fam}`;
}

/** Envelope box (mm) for a fastener — head-dominated footprint × length. */
function envelopeFor(
  row: MetricFastener,
  shape: FastenerFamily["shape"],
  lengthMm: number | undefined
): [number, number, number] {
  // Nuts/washers/inserts have no shank length; screws stand `lengthMm` tall
  // plus their head height.
  const foot = row.headDiaMm;
  if (shape !== "screw") {
    const h =
      shape === "nut"
        ? row.headHeightMm + 1 // nut is thicker than a cap head; approximate
        : shape === "washer"
          ? 1.0
          : row.headHeightMm; // insert ~ head height tall
    return [foot, foot, Number(h.toFixed(2))];
  }
  const shank = lengthMm ?? 10;
  return [foot, foot, Number((row.headHeightMm + shank).toFixed(2))];
}
