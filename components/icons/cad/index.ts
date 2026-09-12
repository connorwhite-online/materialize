/**
 * Construction-operation glyphs for the Prometheus feature timeline.
 *
 * One icon per file, matching the rest of components/icons/; they live in a
 * subdirectory because they are a SET — nine glyphs designed against each
 * other (fillet and chamfer share a composition on purpose, loft and extrude
 * deliberately don't) rather than nine unrelated one-off marks.
 *
 * `CAD_OP_ICONS` is typed as a total Record over TimelineIconKind, so adding
 * a kind to that union is a type error here until it has a glyph. The chips
 * are icon-only — there is no text fallback to degrade to, so a missing icon
 * would render an empty chip.
 */

import type { TimelineIconKind } from "@/components/cad/feature-timeline";

import { BooleanOp } from "./boolean";
import { ChamferOp } from "./chamfer";
import { ExtrudeOp } from "./extrude";
import { FilletOp } from "./fillet";
import { GenericOp } from "./generic";
import { HoleOp } from "./hole";
import { LoftOp } from "./loft";
import { RevolveOp } from "./revolve";
import { ShellOp } from "./shell";

export {
  BooleanOp,
  ChamferOp,
  ExtrudeOp,
  FilletOp,
  GenericOp,
  HoleOp,
  LoftOp,
  RevolveOp,
  ShellOp,
};

export const CAD_OP_ICONS: Record<TimelineIconKind, typeof GenericOp> = {
  extrude: ExtrudeOp,
  revolve: RevolveOp,
  boolean: BooleanOp,
  fillet: FilletOp,
  chamfer: ChamferOp,
  shell: ShellOp,
  loft: LoftOp,
  hole: HoleOp,
  generic: GenericOp,
};
