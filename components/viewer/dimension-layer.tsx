"use client";

/**
 * Dimension annotation layer (MTR-197 phase 3): renders the persisted
 * dimension-contract verdicts ON the model, so "the dimensions were honored"
 * is something the user can see against the geometry instead of taking on
 * faith. A toggleable layer beside the measure tool and cross-section.
 *
 * Trust rules (the whole point of the layer):
 *  - Every number shown beside the spec is MEASURED from the built geometry
 *    by the deterministic checker (lib/cad/dimension-check.ts) — the model
 *    never freehands a value or a position onto this layer.
 *  - A check that did not run renders as "not verified" (muted), never as a
 *    pass. The honesty rail extends to pixels.
 *
 * Three pieces, matching where each lives in the scene graph:
 *  - `DimensionExtents`   — bbox_span callouts as engineering-drawing extent
 *    lines, drawn in WORLD space from the measured world bounding box
 *    (rendered at the Canvas level, like the grid / section cap).
 *  - `DimensionFaceCallouts` — diameter/distance callouts anchored to the
 *    B-rep faces the checker matched (`faceIds` → topology `triRange`s →
 *    mesh triangles), drawn in MODEL space inside the model group so the
 *    shared frame transform places them exactly on the geometry.
 *  - `DimensionLegend`    — the complete verdict list as a DOM overlay
 *    (includes count/fit/not-run targets that have no natural line in 3D).
 */

import { useMemo } from "react";
import { Html, Line } from "@react-three/drei";
import { CheckIcon, CircleDashedIcon, XIcon } from "lucide-react";
import type { DimensionCheckResult } from "@/lib/cad/dimension-check";
import {
  positionsForTriangleRanges,
  triangleRangesForFaceIds,
} from "@/lib/cad/features";
import { type CadTopology } from "./topology";
import type { BufferGeometry } from "three";

type Vec3 = [number, number, number];

/** Trim to 2 dp and drop trailing zeros: 49.98, 50, 7.5. */
function fmtMm(n: number): string {
  return Number(n.toFixed(2)).toString();
}

/** Pass = emerald, fail = red, not-run = muted. Shared by lines + labels. */
function statusColor(check: DimensionCheckResult): string {
  if (!check.ran) return "#9ca3af";
  return check.ok ? "#059669" : "#dc2626";
}

/** "spec 50 ±0.5 · 49.98 ✓" — the measured-beside-claimed core of the layer. */
function verdictText(check: DimensionCheckResult): string {
  const unit = check.target.kind === "count" ? "" : " mm";
  const tol =
    check.tolerance != null && check.tolerance > 0
      ? ` ±${fmtMm(check.tolerance)}`
      : "";
  const spec = `${fmtMm(check.target.value)}${tol}${unit}`;
  if (!check.ran) return `${spec} · not verified`;
  if (check.got == null) return `${spec} · not found`;
  return `${spec} · ${fmtMm(check.got)}${unit} ${check.ok ? "✓" : "✗"}`;
}

/** Floating annotation pill, anchored at a scene position. */
function CalloutLabel({
  position,
  title,
  check,
}: {
  position: Vec3;
  title: string;
  check: DimensionCheckResult;
}) {
  const color = statusColor(check);
  return (
    <Html position={position} center zIndexRange={[40, 0]} style={{ pointerEvents: "none" }}>
      <div
        className="whitespace-nowrap rounded-full border bg-background/80 px-2 py-0.5 text-[10px] tabular-nums backdrop-blur-md"
        style={{ color, borderColor: `${color}66` }}
      >
        <span className="font-medium">{title}</span>{" "}
        <span className="opacity-90">{verdictText(check)}</span>
      </div>
    </Html>
  );
}

/** The world-space axis-aligned box the extent callouts dimension. */
export interface DimensionWorldBox {
  min: Vec3;
  max: Vec3;
}

/**
 * bbox_span extent callouts: extension lines off the measured world bounding
 * box + a dimension line offset outside it, engineering-drawing style. Each
 * axis gets a fixed home (x: bottom-front, y: front-right vertical, z:
 * bottom-right) so multiple callouts never overlap; a second callout on the
 * same axis stacks one offset step further out.
 */
export function DimensionExtents({
  box,
  checks,
}: {
  box: DimensionWorldBox;
  checks: DimensionCheckResult[];
}) {
  const spans = checks.filter(
    (c) => c.target.kind === "bbox_span" && c.target.axis && c.ran
  );
  if (spans.length === 0) return null;

  const { min, max } = box;
  const size: Vec3 = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
  const off = Math.max(size[0], size[1], size[2]) * 0.09;

  const perAxisIndex: Record<string, number> = {};
  return (
    <group renderOrder={1000}>
      {spans.map((check, i) => {
        const axis = check.target.axis!;
        const stack = perAxisIndex[axis] ?? 0;
        perAxisIndex[axis] = stack + 1;
        const d = off * (1 + stack * 0.9);

        // Anchor corners on the box and the offset dimension line per axis.
        let cornerA: Vec3;
        let cornerB: Vec3;
        let a: Vec3;
        let b: Vec3;
        if (axis === "x") {
          cornerA = [min[0], min[1], max[2]];
          cornerB = [max[0], min[1], max[2]];
          a = [min[0], min[1] - d, max[2] + d];
          b = [max[0], min[1] - d, max[2] + d];
        } else if (axis === "y") {
          cornerA = [max[0], min[1], max[2]];
          cornerB = [max[0], max[1], max[2]];
          a = [max[0] + d, min[1], max[2] + d];
          b = [max[0] + d, max[1], max[2] + d];
        } else {
          cornerA = [max[0], min[1], min[2]];
          cornerB = [max[0], min[1], max[2]];
          a = [max[0] + d, min[1] - d, min[2]];
          b = [max[0] + d, min[1] - d, max[2]];
        }
        const mid: Vec3 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
        const color = statusColor(check);
        return (
          <group key={`${axis}-${i}`}>
            <Line points={[cornerA, a]} color={color} lineWidth={1} depthTest={false} transparent opacity={0.5} />
            <Line points={[cornerB, b]} color={color} lineWidth={1} depthTest={false} transparent opacity={0.5} />
            <Line points={[a, b]} color={color} lineWidth={1.5} depthTest={false} />
            <CalloutLabel position={mid} title={check.target.label} check={check} />
          </group>
        );
      })}
    </group>
  );
}

/** Mean of a flat xyz position array. */
function meanOfPositions(positions: number[]): Vec3 | null {
  const n = positions.length / 3;
  if (n === 0) return null;
  let x = 0;
  let y = 0;
  let z = 0;
  for (let i = 0; i < positions.length; i += 3) {
    x += positions[i];
    y += positions[i + 1];
    z += positions[i + 2];
  }
  return [x / n, y / n, z / n];
}

/** Centroid (model mm) of a set of topology faces, via their mesh triangles. */
function facesCentroid(
  geom: BufferGeometry,
  topo: CadTopology,
  faceIds: number[]
): Vec3 | null {
  const posAttr = geom.attributes.position;
  if (!posAttr) return null;
  const index = geom.index;
  const triCount = (index ? index.count : posAttr.count) / 3;
  const ranges = triangleRangesForFaceIds(topo, faceIds);
  if (ranges.length === 0) return null;
  const positions = positionsForTriangleRanges(
    posAttr.array as ArrayLike<number>,
    index ? (index.array as ArrayLike<number>) : null,
    triCount,
    ranges
  );
  return meanOfPositions(positions);
}

/** Per-callout anchor resolved from the matched faces. */
interface FeatureAnchor {
  check: DimensionCheckResult;
  /** Label anchor (model mm). */
  point: Vec3;
  /** Closed circle rings to highlight (diameter callouts). */
  rings: Vec3[][];
  /** Span segment between the two matched planes (distance callouts). */
  segment: [Vec3, Vec3] | null;
}

/**
 * Feature-level callouts (diameter / distance), anchored to the faces the
 * deterministic checker matched. Rendered INSIDE the model group (model-space
 * mm) so the shared frame transform lands them exactly on the geometry —
 * same contract as the topology edge guides.
 */
export function DimensionFaceCallouts({
  geom,
  topo,
  checks,
}: {
  geom: BufferGeometry;
  topo: CadTopology;
  checks: DimensionCheckResult[];
}) {
  const anchors = useMemo<FeatureAnchor[]>(() => {
    const out: FeatureAnchor[] = [];
    for (const check of checks) {
      if (!check.ran || !check.faceIds?.length) continue;
      const kind = check.target.kind;
      if (kind !== "diameter" && kind !== "distance") continue;
      const faceIds = check.faceIds.slice(0, 12);
      const idSet = new Set(faceIds);

      if (kind === "diameter") {
        // Circular boundary edges of the matched cylindrical faces — the
        // natural place a ⌀ callout rings. One ring per face, capped.
        const ringsByFace = new Map<number, Vec3[]>();
        for (const edge of topo.edges) {
          if (edge.curve !== "circle") continue;
          const faceId = edge.faceIds.find((id) => idSet.has(id));
          if (faceId == null || ringsByFace.has(faceId)) continue;
          if (edge.polyline.length < 3) continue;
          ringsByFace.set(faceId, [...edge.polyline, edge.polyline[0]]);
          if (ringsByFace.size >= 8) break;
        }
        const rings = [...ringsByFace.values()];
        const point =
          rings[0] != null
            ? meanOfPositions(rings[0].flat())
            : facesCentroid(geom, topo, faceIds);
        if (!point) continue;
        out.push({ check, point, rings, segment: null });
        continue;
      }

      // distance: split the matched faces into the two parallel planes by
      // clustering their centroids along the pair's largest-gap direction,
      // then span a segment between the cluster centroids.
      const centroids = faceIds
        .map((id) => facesCentroid(geom, topo, [id]))
        .filter((c): c is Vec3 => c !== null);
      if (centroids.length < 2) continue;
      const mean = meanOfPositions(centroids.flat())!;
      // Direction of maximum spread among centroids (power-iteration-free:
      // the dominant axis of the centroid deltas is enough for two clusters).
      let dir: Vec3 = [0, 0, 1];
      let best = -1;
      for (const c of centroids) {
        const dv: Vec3 = [c[0] - mean[0], c[1] - mean[1], c[2] - mean[2]];
        const len = Math.hypot(dv[0], dv[1], dv[2]);
        if (len > best) {
          best = len;
          if (len > 1e-9) dir = [dv[0] / len, dv[1] / len, dv[2] / len];
        }
      }
      const side = (c: Vec3) =>
        (c[0] - mean[0]) * dir[0] + (c[1] - mean[1]) * dir[1] + (c[2] - mean[2]) * dir[2];
      const near = centroids.filter((c) => side(c) <= 0);
      const far = centroids.filter((c) => side(c) > 0);
      if (near.length === 0 || far.length === 0) continue;
      const aPt = meanOfPositions(near.flat())!;
      const bPt = meanOfPositions(far.flat())!;
      out.push({
        check,
        point: [(aPt[0] + bPt[0]) / 2, (aPt[1] + bPt[1]) / 2, (aPt[2] + bPt[2]) / 2],
        rings: [],
        segment: [aPt, bPt],
      });
    }
    return out;
  }, [geom, topo, checks]);

  if (anchors.length === 0) return null;
  return (
    <group renderOrder={1000}>
      {anchors.map((anchor, i) => {
        const color = statusColor(anchor.check);
        const isDiameter = anchor.check.target.kind === "diameter";
        return (
          <group key={i}>
            {anchor.rings.map((ring, r) => (
              <Line key={r} points={ring} color={color} lineWidth={2} depthTest={false} />
            ))}
            {anchor.segment && (
              <Line
                points={anchor.segment}
                color={color}
                lineWidth={1.5}
                depthTest={false}
              />
            )}
            <CalloutLabel
              position={anchor.point}
              title={`${isDiameter ? "⌀ " : ""}${anchor.check.target.label}`}
              check={anchor.check}
            />
          </group>
        );
      })}
    </group>
  );
}

/**
 * The complete verdict list as a DOM overlay — every declared target, whether
 * or not it has a 3D anchor (count, fit, and not-run targets live only here).
 * The honest scoreboard behind the on-model callouts.
 */
export function DimensionLegend({
  checks,
  className,
}: {
  checks: DimensionCheckResult[];
  className?: string;
}) {
  if (checks.length === 0) return null;
  return (
    <div
      className={`max-h-56 w-64 overflow-y-auto rounded-xl border border-border/60 bg-background/60 p-2 text-[11px] backdrop-blur-md ${className ?? ""}`}
    >
      <div className="mb-1 px-1 font-medium text-muted-foreground">
        Dimension contract
      </div>
      <ul className="flex flex-col gap-1">
        {checks.map((check, i) => {
          const color = statusColor(check);
          return (
            <li key={i} className="flex items-start gap-1.5 rounded-lg px-1 py-0.5">
              <span className="mt-0.5 shrink-0" style={{ color }}>
                {!check.ran ? (
                  <CircleDashedIcon className="size-3" aria-label="Not verified" />
                ) : check.ok ? (
                  <CheckIcon className="size-3" aria-label="In spec" />
                ) : (
                  <XIcon className="size-3" aria-label="Out of spec" />
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-foreground/90">
                  {check.target.label}
                  {check.target.param ? (
                    <span className="ml-1 font-mono text-[10px] text-muted-foreground">
                      {check.target.param}
                    </span>
                  ) : null}
                </span>
                <span className="block tabular-nums" style={{ color }}>
                  {verdictText(check)}
                </span>
                {!check.ran && check.note ? (
                  <span className="block text-[10px] text-muted-foreground">
                    {check.note}
                  </span>
                ) : null}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
