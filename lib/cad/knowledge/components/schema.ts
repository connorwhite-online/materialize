/**
 * Component mechanical schema (MTR-204 fit contract, extended for the MTR-203
 * registry). Data lives in the sibling category files (boards.ts, sensors.ts,
 * actuators.ts, displays.ts, power.ts, cameras.ts); lookup + prompt/fit
 * machinery live in index.ts. Same license posture as fasteners.ts:
 * dimensions are uncopyrightable facts, re-tabled in our own values, each
 * entry carrying provenance for the source actually consulted.
 *
 * COMPONENT FRAME convention (every position below uses it):
 *   origin  = center of the PCB/body footprint
 *   +x      = along the LENGTH (the longer footprint axis)
 *   +y      = along the width
 *   z       = up; exit heights are measured above the PCB TOP face.
 * The fit verifier (cad-runner/fit.py) solves the component's actual pose
 * inside the built mesh, trying all four flat rotations — so the ±x choice for
 * "which end the USB is on" is a convention, not an assertion.
 */

/** Where a mechanical fact set came from, and whether it was actually read. */
export interface ComponentProvenance {
  /** URL of the mechanical source actually consulted. */
  sourceUrl: string;
  /** Document/file revision or snapshot identifier at that source. */
  docRevision: string;
  /** ISO date the source was last checked. */
  dateChecked: string;
  /**
   * True when the positions in the entry were read off the cited source.
   * False = envelope-level facts only; positional fields are absent or
   * marked `approx` and MUST NOT be fit-enforced.
   */
  verified: boolean;
  note?: string;
}

/** One mounting hole, component frame, mm. */
export interface MountingHole {
  xMm: number;
  yMm: number;
  diaMm: number;
}

/**
 * How the component fixes to the enclosure. Discriminated union so actuators
 * (flange/tab mounts, MTR-203) join without a schema migration.
 */
export type ComponentMounting =
  | { kind: "hole-pattern"; holes: MountingHole[]; note?: string }
  | {
      /**
       * Flange/tab mounting (servos, gearmotors, panel bushings). `holes` are
       * the screw holes THROUGH the flange, component frame. The flange plane
       * sits `flangeAtMm` above the body bottom (servo ears are partway up).
       */
      kind: "flange";
      holes?: MountingHole[];
      flangeThicknessMm?: number;
      flangeAtMm?: number;
      /** Full span across the flange ears (length direction), mm. */
      flangeSpanMm?: number;
      note?: string;
    }
  | { kind: "none"; note?: string };

/** Everything the enclosure must open up or leave room for (MTR-203). */
export type ComponentExitKind =
  | "connector"
  | "shaft"
  | "lens"
  | "screen_window"
  | "button"
  | "sensor_window"
  | "vent";

/** A lateral component edge, component frame (see convention above). */
export type ComponentEdge = "+x" | "-x" | "+y" | "-y";

export interface ComponentExit {
  kind: ComponentExitKind;
  /** COMPONENT_CUTOUTS std id when kind is "connector". */
  std?: string;
  /**
   * Edge/face the exit lives on. Omitted only for top/bottom exits
   * (direction "+z"/"-z") located via `centerMm`.
   */
  edge?: ComponentEdge;
  /** Offset of the exit center along that edge, from the edge midpoint, mm. */
  offsetMm?: number;
  /** Exit center height above the PCB top face, mm. */
  heightMm?: number;
  /** Opening size when it differs from the std cutout (w along edge, h up). */
  dims?: { wMm: number; hMm: number };
  /** Round exits (shafts, lenses, sensor cans): opening diameter, mm. */
  diaMm?: number;
  /** Protrusion direction when not the edge's outward normal (e.g. "+z"). */
  direction?: ComponentEdge | "+z" | "-z";
  /**
   * Exit center in the component frame (x, y), mm — used for "+z"/"-z"
   * direction exits (screen windows, lenses, shafts) where edge/offset does
   * not apply.
   */
  centerMm?: [number, number];
  /**
   * Position is nominal (not read off a verified drawing): still shown in
   * prompt hints, but NEVER fit-enforced — see ComponentProvenance.verified.
   */
  approx?: boolean;
  note?: string;
}

/** Clearance the enclosure must keep open around/above the component. */
export interface ComponentKeepOut {
  kind: "antenna" | "thermal" | "wire-bend" | "insertion" | "acoustic";
  note: string;
}

/** Stack composition (MTR-203: drape consumes component STACKS). */
export interface ComponentStacking {
  /** Component id this part usually sits on / plugs into. */
  sitsOn?: string;
  /** Header/socket height between the two boards, mm. */
  headerHeightMm?: number;
  /** Extra clearance to leave above this part, mm. */
  clearanceAboveMm?: number;
  note?: string;
}

export type ComponentCategory =
  | "board"
  | "sensor"
  | "actuator"
  | "display"
  | "power"
  | "camera";

/**
 * One registry entry — true body dimensions and mounting facts for the parts
 * people most often ask for enclosures around. Exists so "ESP32 enclosure"
 * gets REAL dims implied automatically (the brief must never ask the user to
 * confirm a guessed bounding box for a known part), so the code model learns
 * facts like "DevKitC has no mounting holes", and — since MTR-204 — so the
 * sidecar can VERIFY the built enclosure actually fits the part (cavity,
 * bosses, cutouts) instead of trusting the prompt.
 */
export interface ComponentSpec {
  id: string;
  label: string;
  category: ComponentCategory;
  aliases: string[];
  /**
   * Body/PCB length x width x thickness, mm. For PCB modules this is the bare
   * PCB and `tallestAboveMm` carries the parts above it; for solid bodies
   * (servos, motors, potted modules) it is the full body and the note says so.
   */
  boardMm: [number, number, number];
  /** Mounting interface; positions in the component frame. */
  mounting: ComponentMounting;
  /** Ports and other openings the enclosure must accommodate. */
  exits: ComponentExit[];
  /** Tallest component above the board top, mm. */
  tallestAboveMm?: number;
  /** Pin/lead protrusion below the board, mm. */
  pinsBelowMm?: number;
  /** Clearances the enclosure must respect (antenna, heat, wire bends). */
  keepOuts?: ComponentKeepOut[];
  /** Stack composition (MTR-203). */
  stacking?: ComponentStacking;
  /** Source of the mechanical facts + whether positions were verified. */
  provenance?: ComponentProvenance;
  note?: string;
}

/** Back-compat alias — the fit-contract schema landed with this name. */
export type DevBoard = ComponentSpec;
