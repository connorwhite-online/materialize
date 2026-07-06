/**
 * Component-spec registry (MTR-203) — provenance-tracked REAL dimensions for
 * the maker hardware-stack canon, plus the lookup / prompt-hint / fit-target
 * machinery the brief and harness consume. Public API is unchanged from the
 * original single-file knowledge/components.ts; data lives in the sibling
 * category files.
 */

import type { CadBrief } from "../../brief";
import type { DimensionTarget } from "../../dimension-check";
import { METRIC_FASTENERS, type MetricFastener } from "../fasteners";
import { ACTUATORS } from "./actuators";
import { DEV_BOARDS } from "./boards";
import { CAMERAS } from "./cameras";
import { COMPONENT_CUTOUTS, type ComponentCutout } from "./cutouts";
import { DISPLAYS } from "./displays";
import { POWER } from "./power";
import type {
  ComponentCategory,
  ComponentEdge,
  ComponentExit,
  ComponentMounting,
  ComponentSpec,
  DevBoard,
} from "./schema";
import { SENSORS } from "./sensors";

export { COMPONENT_CUTOUTS, DEV_BOARDS };
export type { ComponentCutout };
export * from "./schema";

/**
 * The full registry, id -> spec. Boards first so historical board lookups
 * keep their precedence; every id is asserted unique at module load.
 */
export const COMPONENT_REGISTRY: Record<string, ComponentSpec> = (() => {
  const groups: Record<string, ComponentSpec>[] = [
    DEV_BOARDS,
    SENSORS,
    ACTUATORS,
    DISPLAYS,
    POWER,
    CAMERAS,
  ];
  const out: Record<string, ComponentSpec> = {};
  for (const group of groups) {
    for (const [id, spec] of Object.entries(group)) {
      if (out[id]) throw new Error(`duplicate component id: ${id}`);
      out[id] = spec;
    }
  }
  return out;
})();

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");

/**
 * Resolve a free-form component name ("ESP32_devkit", "sg90 servo") to a
 * registry row. Exact squashed match wins; otherwise the LONGEST matching
 * candidate wins, so "esp32 feather" resolves to the Feather, not to the
 * DevKitC via its bare "esp32" alias.
 */
export function componentFor(
  name: string,
  category?: ComponentCategory
): ComponentSpec | null {
  const n = squash(name);
  if (!n) return null;
  let best: { row: ComponentSpec; len: number } | null = null;
  for (const row of Object.values(COMPONENT_REGISTRY)) {
    if (category && row.category !== category) continue;
    for (const candidate of [row.id, row.label, ...row.aliases]) {
      const c = squash(candidate);
      if (!c) continue;
      if (n === c) return row;
      if (n.includes(c) && (best === null || c.length > best.len)) {
        best = { row, len: c.length };
      }
    }
  }
  return best?.row ?? null;
}

/**
 * Resolve a free-form dev-board name — the original fit-contract entry point,
 * now a category-restricted view of componentFor.
 */
export function devBoardFor(name: string): DevBoard | null {
  return componentFor(name, "board");
}

/**
 * Compact human/prompt description of a component's mounting interface.
 * Positions are in the component frame (origin body center, +x = length).
 */
function describeMounting(m: ComponentMounting): string {
  if (m.kind === "hole-pattern") {
    const dia = m.holes[0]?.diaMm;
    const uniformDia = m.holes.every((h) => h.diaMm === dia);
    const pts = m.holes.map((h) => `(${h.xMm}, ${h.yMm})`).join(", ");
    return (
      `${m.holes.length} mounting holes${uniformDia ? ` D${dia}` : ""} at ${pts} from board center` +
      (m.note ? ` — ${m.note}` : "")
    );
  }
  if (m.kind === "flange") {
    const bits = ["flange/tab mount"];
    if (m.holes && m.holes.length > 0) {
      const dia = m.holes[0]?.diaMm;
      const uniformDia = m.holes.every((h) => h.diaMm === dia);
      const pts = m.holes.map((h) => `(${h.xMm}, ${h.yMm})`).join(", ");
      bits.push(
        `${m.holes.length} flange holes${uniformDia ? ` D${dia}` : ""} at ${pts} from body center`
      );
    }
    if (m.flangeSpanMm != null) bits.push(`ears span ${m.flangeSpanMm}`);
    if (m.flangeAtMm != null)
      bits.push(`flange underside ${m.flangeAtMm} above body bottom`);
    if (m.flangeThicknessMm != null)
      bits.push(`flange ${m.flangeThicknessMm} thick`);
    if (m.note) bits.push(m.note);
    return bits.join(", ");
  }
  return m.note ?? "no mounting holes";
}

/** Compact human/prompt description of one exit (port, shaft, window, …). */
function describeExit(e: ComponentExit): string {
  const what = e.std ?? e.kind.replace("_", " ");
  const size =
    e.diaMm != null
      ? `D${e.diaMm}`
      : e.dims
        ? `${e.dims.wMm} x ${e.dims.hMm}`
        : null;
  if (e.direction === "+z" || e.direction === "-z") {
    const face = e.direction === "+z" ? "top face" : "underside";
    const bits = [
      `${what}${size ? ` ${size}` : ""} on the ${face}`,
      e.centerMm
        ? `centered at (${e.centerMm[0]}, ${e.centerMm[1]}) from body center`
        : null,
      e.approx ? "(position approximate)" : null,
    ].filter(Boolean);
    return bits.join(", ");
  }
  const where =
    e.edge === "+x" || e.edge === "-x" ? "a short end" : "a long side";
  const off = e.offsetMm ?? 0;
  const bits = [
    `${what}${size && e.kind !== "connector" ? ` ${size}` : ""} on ${where}`,
    off !== 0 ? `${Math.abs(off)} mm ${off > 0 ? "+" : "-"}y of center` : "centered",
    e.heightMm != null ? `center ${e.heightMm} above board top` : null,
    e.approx ? "(position approximate)" : null,
  ].filter(Boolean);
  return bits.join(", ");
}

/** One catalog line for a component — true dims, no guessing. */
function catalogLine(c: ComponentSpec): string {
  const bits = [
    `${c.label}: ${c.category === "board" ? "PCB" : "body"} ${c.boardMm.join(" x ")} mm`,
    describeMounting(c.mounting),
    ...c.exits.map(describeExit),
    c.tallestAboveMm ? `parts to ${c.tallestAboveMm} above board` : null,
    c.pinsBelowMm ? `pins ${c.pinsBelowMm} below` : null,
    ...(c.keepOuts ?? []).map((k) => `keep-out (${k.kind}): ${k.note}`),
  ].filter(Boolean);
  return `- ${bits.join("; ")}`;
}

/** One line per board for the brief system prompt (kept for compatibility). */
export function formatBoardCatalog(): string {
  return Object.values(DEV_BOARDS).map(catalogLine).join("\n");
}

const CATEGORY_LABELS: Record<ComponentCategory, string> = {
  board: "Dev boards",
  sensor: "Sensors & input modules",
  actuator: "Actuators & motors",
  display: "Displays & LEDs",
  power: "Power & charging",
  camera: "Cameras",
};

/**
 * The full component catalog for the brief system prompt, grouped by
 * category — one compact line per part so the model composes stacks from
 * REAL dimensions instead of memory.
 */
export function formatComponentCatalog(): string {
  const lines: string[] = [];
  for (const cat of Object.keys(CATEGORY_LABELS) as ComponentCategory[]) {
    const rows = Object.values(COMPONENT_REGISTRY).filter(
      (c) => c.category === cat
    );
    if (rows.length === 0) continue;
    lines.push(`${CATEGORY_LABELS[cat]}:`);
    lines.push(...rows.map(catalogLine));
  }
  return lines.join("\n");
}

/** Screw sizes the brief may reference via `std`/`mounts.screw` (e.g. "M2.5"). */
const SCREW_STD = /^m\s?(2\.5|2|3|4|5|6)$/i;

function normalize(std: string): string {
  return std.trim().toLowerCase();
}

/** Resolve a brief `std` string to a cutout row, tolerant of alias spellings. */
export function componentCutoutFor(std: string): ComponentCutout | null {
  const n = normalize(std);
  for (const row of Object.values(COMPONENT_CUTOUTS)) {
    if (row.id === n || row.aliases.includes(n)) return row;
  }
  return null;
}

/** Resolve a screw reference ("M3", "m2.5") to the fastener table row. */
export function screwFor(std: string): MetricFastener | null {
  const m = normalize(std).match(SCREW_STD);
  if (!m) return null;
  return METRIC_FASTENERS[`M${m[1]}`.replace(".", "_")] ?? null;
}

/**
 * Emit real cutout/hole dimensions for every `interfaces[].std` (and
 * `components[].mounts.screw`) the brief references. "" when nothing matches —
 * the harness appends this next to the brief so dims land in the prompt.
 */
export function formatComponentHints(brief: CadBrief): string {
  const cutouts = new Map<string, ComponentCutout>();
  const screws = new Map<string, MetricFastener>();
  const parts = new Map<string, ComponentSpec>();

  for (const comp of brief.components ?? []) {
    const part = componentFor(comp.name);
    if (part) {
      parts.set(part.id, part);
      for (const exit of part.exits) {
        if (exit.std) {
          const cut = componentCutoutFor(exit.std);
          if (cut) cutouts.set(cut.id, cut);
        }
      }
    }
  }

  for (const iface of brief.interfaces ?? []) {
    if (!iface.std) continue;
    const cut = componentCutoutFor(iface.std);
    if (cut) cutouts.set(cut.id, cut);
    const screw = screwFor(iface.std);
    if (screw) screws.set(screw.size, screw);
  }
  for (const comp of brief.components ?? []) {
    const screwRef = comp.mounts?.screw;
    if (typeof screwRef === "string") {
      const screw = screwFor(screwRef);
      if (screw) screws.set(screw.size, screw);
    }
  }

  if (cutouts.size === 0 && screws.size === 0 && parts.size === 0) return "";

  const lines = [
    "Interface cutout dimensions (mm) — use these exact sizes, do not guess:",
  ];
  for (const b of parts.values()) {
    const bits = [
      `${b.category === "board" ? "PCB" : "body"} ${b.boardMm.join(" x ")}`,
      describeMounting(b.mounting),
      ...b.exits.map(describeExit),
      b.tallestAboveMm != null
        ? `components to ${b.tallestAboveMm} above the board`
        : null,
      b.pinsBelowMm ? `pins ${b.pinsBelowMm} below` : null,
      ...(b.keepOuts ?? []).map((k) => `keep-out (${k.kind}): ${k.note}`),
      b.stacking?.sitsOn
        ? `usually sits on ${b.stacking.sitsOn}${b.stacking.headerHeightMm != null ? ` (${b.stacking.headerHeightMm} mm header)` : ""}`
        : null,
      b.note,
    ].filter(Boolean);
    lines.push(`- ${b.label}: ${bits.join("; ")}`);
  }
  for (const c of cutouts.values()) {
    lines.push(
      `- ${c.label}: cutout ${c.cutoutWMm} x ${c.cutoutHMm}` +
        (c.bodyDepthMm ? `, body depth ${c.bodyDepthMm} behind the wall` : "") +
        (c.note ? ` (${c.note})` : "")
    );
  }
  for (const s of screws.values()) {
    lines.push(
      `- ${s.size} screws: clearance hole ${s.clearanceHoleMm}, tapped/self-tap pilot ${s.tapDrillMm}, heat-set insert bore ${s.heatSetBoreMm}`
    );
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Fit contract (MTR-204): auto-emitted fit targets for known components.
// ---------------------------------------------------------------------------

/**
 * The component spec the sidecar fit verifier (cad-runner/fit.py) consumes.
 * Carried on the `fit_cavity` target's `fit` field; the sibling boss/cutout
 * targets reference it by component id. All mm, component frame (see the
 * schema comment above).
 */
export interface ComponentFitSpec {
  id: string;
  label: string;
  boardMm: [number, number, number];
  /** Air gap required around the component footprint (from the brief). */
  clearanceMm: number;
  /** Tallest part above the PCB top. */
  aboveMm: number;
  /** Pin/lead protrusion below the PCB bottom (not yet fit-enforced). */
  belowMm: number;
  /** Mounting-hole pattern to match bosses against; null = none. */
  holes: { positions: [number, number][]; diaMm: number } | null;
  /** Openings that must be clear (verified positions only). */
  ports: {
    id: string;
    /** Lateral ports: edge + offset. Top-face ports: face "+z" + x/y. */
    edge?: ComponentEdge;
    offsetMm?: number;
    heightMm?: number;
    face?: "+z";
    xMm?: number;
    yMm?: number;
    wMm: number;
    hMm: number;
  }[];
}

/** Default air gap around a component when the brief doesn't state one. */
const DEFAULT_CLEARANCE_MM = 1.0;

/**
 * Mounting holes eligible for boss targets: hole-pattern holes always; flange
 * holes only when they lie inside/over the body footprint is NOT knowable
 * here, so flange holes are included too — the sidecar solves the pose and
 * checks for matching bosses/posts under each hole either way.
 */
function mountingHoles(spec: ComponentSpec) {
  if (spec.mounting.kind === "none") return null;
  const holes = spec.mounting.holes ?? [];
  if (holes.length === 0) return null;
  return {
    positions: holes.map((h) => [h.xMm, h.yMm] as [number, number]),
    // Conservative: verify against the largest hole in the pattern.
    diaMm: Math.max(...holes.map((h) => h.diaMm)),
  };
}

/** Build the sidecar fit spec for one component (+ the brief's clearance). */
export function fitSpecForComponent(
  spec: ComponentSpec,
  clearanceMm?: number | null
): ComponentFitSpec {
  // Verified-gating: an entry whose provenance was not position-verified
  // contributes NO enforceable holes/ports — hints only (see schema).
  const verified = spec.provenance?.verified === true;
  const holes = verified ? mountingHoles(spec) : null;
  const ports = !verified
    ? []
    : spec.exits.flatMap((e): ComponentFitSpec["ports"] => {
        if (e.approx) return [];
        if (
          e.kind === "screen_window" ||
          ((e.kind === "lens" || e.kind === "sensor_window" || e.kind === "shaft") &&
            e.direction === "+z")
        ) {
          if (e.direction !== "+z" || !e.centerMm) return [];
          const wMm = e.dims?.wMm ?? e.diaMm;
          const hMm = e.dims?.hMm ?? e.diaMm;
          if (wMm == null || hMm == null) return [];
          return [
            {
              id: e.kind === "screen_window" ? "screen-window" : e.kind,
              face: "+z" as const,
              xMm: e.centerMm[0],
              yMm: e.centerMm[1],
              wMm,
              hMm,
            },
          ];
        }
        if (e.kind === "connector" && e.std && e.edge) {
          const cut = componentCutoutFor(e.std);
          const wMm = e.dims?.wMm ?? cut?.cutoutWMm;
          const hMm = e.dims?.hMm ?? cut?.cutoutHMm;
          if (wMm == null || hMm == null) return [];
          return [
            {
              id: e.std,
              edge: e.edge,
              offsetMm: e.offsetMm ?? 0,
              heightMm: e.heightMm ?? 0,
              wMm,
              hMm,
            },
          ];
        }
        return [];
      });
  return {
    id: spec.id,
    label: spec.label,
    boardMm: spec.boardMm,
    clearanceMm: clearanceMm ?? DEFAULT_CLEARANCE_MM,
    aboveMm: spec.tallestAboveMm ?? 0,
    belowMm: spec.pinsBelowMm ?? 0,
    holes,
    ports,
  };
}

/** Back-compat alias — the fit-contract landed with the board-only name. */
export const fitSpecForBoard = fitSpecForComponent;

/**
 * Emit machine-checkable FIT targets for every known component the brief
 * names (MTR-204): cavity containment, boss↔hole pattern match, cutout↔port
 * alignment. These ride the exact same per-target pass/fail → repair-hint
 * machinery as the MTR-197 dimension targets (lib/cad/dimension-check.ts);
 * the sidecar evaluates them against the real built mesh, and targets it
 * didn't evaluate report `ran: false` (honesty rail) — never "verified".
 *
 * Only VERIFIED positions are enforced: an entry whose provenance couldn't be
 * checked keeps its hints but emits no boss/cutout targets (`approx` exits
 * and unverified entries are skipped in fitSpecForComponent).
 */
export function fitTargetsForBrief(brief: CadBrief): DimensionTarget[] {
  const targets: DimensionTarget[] = [];
  const seen = new Set<string>();
  for (const comp of brief.components ?? []) {
    const part = componentFor(comp.name);
    if (!part || seen.has(part.id)) continue;
    seen.add(part.id);
    const clearance = typeof comp.clearance === "number" ? comp.clearance : null;
    const spec = fitSpecForComponent(part, clearance);

    targets.push({
      label: `${part.label} cavity fit (body + ${spec.clearanceMm} mm clearance)`,
      kind: "fit_cavity",
      id: `fit:${part.id}:cavity`,
      value: 1,
      tolerance: 0,
      fit: spec,
    });
    if (spec.holes) {
      targets.push({
        label: `${part.label} mounting bosses (${spec.holes.positions.length}-hole pattern)`,
        kind: "fit_bosses",
        id: `fit:${part.id}:bosses`,
        value: spec.holes.positions.length,
        tolerance: 0,
        fit: { component: part.id },
      });
    }
    for (const port of spec.ports) {
      targets.push({
        label: `${part.label} ${port.id} ${port.face === "+z" ? "window" : "cutout"} (${port.wMm} x ${port.hMm} mm)`,
        kind: "fit_cutout",
        id: `fit:${part.id}:port:${port.id}`,
        value: 1,
        tolerance: 0,
        fit: { component: part.id },
      });
    }
  }
  return targets;
}
