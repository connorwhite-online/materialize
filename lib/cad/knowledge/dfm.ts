/**
 * Process-specific Design-for-Manufacturing (DFM) rules for the additive
 * processes Materialize fulfils via CraftCloud. Numbers are paraphrased,
 * cross-checked facts (uncopyrightable) distilled from multiple bureau guides
 * (Protolabs Network/Hubs, Formlabs, Xometry, Shapeways, Sculpteo) and the
 * open/public-domain DfAM literature (NIST "Design Rules for Additive
 * Manufacturing" — public domain; MDPI *Machines* DfAM expert-system table —
 * CC BY 4.0). Values are conservative where sources disagree.
 *
 * Units: millimeters / degrees. Encode min-wall and overhang as hard
 * generation constraints; the rest guide design and feed validation.
 *
 * Sequencing note: generation can precede material/vendor selection, so the
 * harness defaults to MULTI_PROCESS_SAFE (the conservative envelope across
 * all processes) and a specific block is used only when the target process
 * is known. Re-validate against the chosen CraftCloud process at print time.
 */

export type CadProcess =
  | "fdm"
  | "sla"
  | "sls"
  | "mjf"
  | "dmls"
  | "binder_jet";

export interface ProcessDfm {
  label: string;
  minWallMm: number;
  /** Min self-supporting angle from horizontal (FDM/metal); null = powder-bed, no supports. */
  overhangSelfSupportDeg: number | null;
  minHoleMm: number;
  clearanceMovingMm: number;
  clearancePressMm: number;
  /** Escape/drain holes for hollow cavities, if required by the process. */
  cavityHole?: { kind: "drain" | "escape"; minDiaMm: number; minCount: number };
  toleranceNote: string;
  notes: string[];
}

export const PROCESS_DFM: Record<CadProcess, ProcessDfm> = {
  fdm: {
    label: "FDM/FFF (fused filament)",
    minWallMm: 1.0,
    overhangSelfSupportDeg: 45,
    minHoleMm: 2.0,
    clearanceMovingMm: 0.4,
    clearancePressMm: 0.15,
    toleranceNote: "~±0.3–0.5 mm; holes print undersized — oversize ~0.2–0.4 mm",
    notes: [
      "Weak along the layer (Z) axis — orient load across layers.",
      "Overhangs steeper than ~45° from horizontal need supports; chamfer/fillet to stay self-supporting.",
    ],
  },
  sla: {
    label: "SLA/DLP resin",
    minWallMm: 0.6,
    overhangSelfSupportDeg: 19,
    minHoleMm: 0.5,
    clearanceMovingMm: 0.5,
    clearancePressMm: 0.1,
    cavityHole: { kind: "drain", minDiaMm: 2.5, minCount: 1 },
    toleranceNote: "fine (~±0.1–0.2 mm); brittle; support scars on down-faces",
    notes: [
      "Every enclosed/hollow cavity MUST have a drain hole or it traps resin (suction → blowout).",
      "Fine features resolve well but are brittle.",
    ],
  },
  sls: {
    label: "SLS nylon (powder bed)",
    minWallMm: 0.8,
    overhangSelfSupportDeg: null,
    minHoleMm: 1.5,
    clearanceMovingMm: 0.4,
    clearancePressMm: 0.2,
    cavityHole: { kind: "escape", minDiaMm: 4.0, minCount: 2 },
    toleranceNote: "~±0.3 mm; no supports needed (powder bed) — complex geometry OK",
    notes: [
      "No supports required — overhangs/undercuts are free.",
      "Enclosed cavities need ≥2 escape holes on opposite sides or powder is trapped.",
    ],
  },
  mjf: {
    label: "MJF nylon (Multi Jet Fusion)",
    minWallMm: 1.0,
    overhangSelfSupportDeg: null,
    minHoleMm: 2.0,
    clearanceMovingMm: 0.7,
    clearancePressMm: 0.2,
    cavityHole: { kind: "escape", minDiaMm: 4.0, minCount: 2 },
    toleranceNote: "~±0.3 mm or ±0.3%; hollow sections thicker than ~7 mm",
    notes: [
      "No supports (powder bed). Hollow thick sections (>7 mm) to a 2–4 mm wall.",
      "Enclosed cavities need ≥2 escape holes (≥4 mm) on opposite sides.",
    ],
  },
  dmls: {
    label: "DMLS/SLM metal",
    minWallMm: 1.0,
    overhangSelfSupportDeg: 45,
    minHoleMm: 1.0,
    clearanceMovingMm: 0.5,
    clearancePressMm: 0.3,
    cavityHole: { kind: "escape", minDiaMm: 3.0, minCount: 2 },
    toleranceNote: "~±0.1–0.2 mm; thermal-stress supports; post-machine for true fits",
    notes: [
      "Overhangs need supports below 45°; large horizontal bores need teardrop/diamond profiles (≤8 mm round).",
      "Expensive; keep wall height:thickness < 40:1.",
    ],
  },
  binder_jet: {
    label: "Binder jetting metal",
    minWallMm: 2.0,
    overhangSelfSupportDeg: null,
    minHoleMm: 1.5,
    clearanceMovingMm: 0.5,
    clearancePressMm: 0.3,
    toleranceNote: "~±2% (<76 mm) / ±3% (≥76 mm); fragile green state → thicker walls",
    notes: [
      "Green-state handling needs generous walls (≥2 mm).",
      "Hole depth:diameter ≤ ~8:1.",
    ],
  },
};

/**
 * Conservative envelope across all processes — used at generation time when
 * the target process isn't known yet (generation precedes material choice).
 * Takes the strictest of each constraint so the part is broadly printable.
 */
export const MULTI_PROCESS_SAFE: ProcessDfm = {
  label: "process-agnostic (conservative)",
  minWallMm: 2.0,
  overhangSelfSupportDeg: 45,
  minHoleMm: 2.0,
  clearanceMovingMm: 0.7,
  clearancePressMm: 0.3,
  cavityHole: { kind: "escape", minDiaMm: 4.0, minCount: 2 },
  toleranceNote: "design conservatively; exact tolerance depends on chosen process",
  notes: [
    "Target process not yet chosen — use conservative values that print on FDM, resin, SLS/MJF, and metal.",
    "Any fully enclosed cavity needs a drain/escape hole regardless of process.",
  ],
};

/** Render a DFM block as terse prompt text. */
export function formatProcessDfm(dfm: ProcessDfm): string {
  const lines = [
    `Manufacturing constraints — ${dfm.label}:`,
    `- Minimum wall thickness: ${dfm.minWallMm} mm.`,
    dfm.overhangSelfSupportDeg === null
      ? `- Powder-bed process: no supports needed; overhangs/undercuts are fine.`
      : `- Overhangs must self-support (≥ ${dfm.overhangSelfSupportDeg}° from horizontal) or be supported.`,
    `- Minimum hole diameter: ${dfm.minHoleMm} mm.`,
    `- Clearance: ${dfm.clearanceMovingMm} mm for moving/assembled parts, ${dfm.clearancePressMm} mm for press fits.`,
  ];
  if (dfm.cavityHole) {
    lines.push(
      `- Any enclosed cavity needs ≥${dfm.cavityHole.minCount} ${dfm.cavityHole.kind} hole(s) ≥ ${dfm.cavityHole.minDiaMm} mm.`
    );
  }
  lines.push(`- Tolerance: ${dfm.toleranceNote}.`);
  for (const n of dfm.notes) lines.push(`- ${n}`);
  return lines.join("\n");
}
