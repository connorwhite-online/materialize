import "server-only";

import { completeText, hasModelCredentials, type PromptImage } from "./model-client";
import { runCadCode } from "./runner-client";
import { extractCode } from "./prompt";
import { exemplarPoolFor, selectExemplars } from "./knowledge/exemplars";
import type { CadBrief } from "./brief";
import type { ConceptDirection } from "./concept-directions";
import type { CadRunResult } from "./types";
import { logError } from "@/lib/logger";

/**
 * Concepts made from GEOMETRY instead of pixels (CAD_CONCEPT_MODE=blockout).
 *
 * The image-model concept is a picture of something the kernel may never
 * build: it draws tube prongs where the exemplars teach molded bars, paper
 * walls, proportions that contradict the brief. The code generator is shown
 * it as the target and the judge grades against it, so an infeasible picture
 * actively pulls the build off course. Prompting harder only nudges a
 * diffusion model; it can't constrain one.
 *
 * Here a fast model writes a coarse SDF BLOCKOUT per direction (massing,
 * sections, blend character, real dimensions) and the sidecar renders it.
 * Every option the user sees is kernel output, so it is feasible by
 * construction, at real scale, rendered with the same clay and camera as the
 * finished part the judge will compare it to. The chosen blockout's code
 * also seeds the implement step (SDF builds).
 *
 * Measured before building this (Haiku 4.5, 3 directions x 4 prompts): ~13s
 * for all three, similar to the flux concepts; 9/12 built; several wrong
 * size. Hence validation (one watertight body, not degenerate, and within the
 * brief's size targets) with one retry per direction, and a fallback to image
 * concepts whenever fewer than two survive.
 *
 * The call runs as the `blockout` role (models.ts): Opus at low effort. Haiku
 * 4.5 wrote these first, and got containers conceptually wrong (cavities cut
 * with smin, stopped under the rim, covered back over); on the same 7 prompts
 * Opus passed 7/7 first try to Haiku's 4/7.
 */

export function blockoutConceptsEnabled(): boolean {
  return process.env.CAD_CONCEPT_MODE === "blockout" && hasModelCredentials();
}

export const CONCEPT_BLOCKOUT_LABEL =
  "Concept BLOCKOUT rendered by the geometry engine: the massing of the chosen direction, feasible and at real scale. Match its proportions, silhouette and form language; add the functional detail it leaves out.";

export const CONCEPT_BLOCKOUT_NOTE =
  "The image captioned \"Concept BLOCKOUT\" is not an AI picture: it was built and rendered by this same geometry engine, at real dimensions. Treat its proportions, silhouette, cross-sections and blend character as the target, and add the functional detail (holes, pins, lips, fillets) that a blockout leaves out.";

export interface BlockoutCandidate {
  direction: ConceptDirection;
  img: PromptImage;
  code: string;
}

export const BLOCKOUT_SYSTEM = `You write quick SDF BLOCKOUTS: the massing of a product concept, not the finished part. They are rendered as concept options for a designer to pick from, so each must read clearly as its design direction AND as the requested object.

Rules:
- Output ONLY one Python code block. Start with \`from sdf_kit import *\` and \`import numpy as np\`.
- Build a field f(P) (P is an (N,3) array; negative inside). Exact signatures:
    sphere(P, center, r)            box(P, center, half)   # half = (hx,hy,hz)
    capsule(P, a, b, r)             tapered_capsule(P, a, b, ra, rb)
    spline_tube(P, points, radii)   # one radius per point
    cyl_z(P, x, y, r, z0, z1)       sq_prism(P, a, b, n, z0, z1)   # superellipse plan
    superellipsoid(P, center, (a, b, c), n, m)
    pocket(P, (x, y), (a, b), floor_z, n=4, r=None)   # OPEN cavity, no top
    smin(a, b, k)  smax(a, b, k)  union(a, b)  subtract(d, hole)  offset_field(a, d)
  Combinators take distance arrays or field functions. For a custom section
  (e.g. a rounded-rectangle bar) compute it with numpy from P directly.
- ONE connected body. Get the REAL overall dimensions (mm) and proportions right.
- KEEP the features that make it recognizable as the object: an organizer's compartments, a cup's opening, a hook's prongs, an enclosure's split line, a tool's handle. A closed blob is not a concept of a container.
- Skip only SMALL functional detail: screw holes, pins, text, clearance gaps.
- CUTTING: smin/union ADD material; subtract(body, cavity) removes it. For anything you put things INTO, cut one pocket() per compartment from the solid body: a pocket has no top, so it always opens through the rim, and the walls between pockets are the dividers. Never add material back over a cavity.
- Product limbs get a designed cross-section, not a round tube. smin at junctions, union along chains. Mating faces are flat.
- Orient it as the object is used (what sits on a table sits on z=0; what mounts on a wall has its back on a plane).
- Mesh coarsely: result = to_mesh(f, lo, hi, pitch) with pitch about 1/60 of the largest dimension (min 0.6). Assign \`result\`.
- Keep it under 50 lines.`;

/**
 * Appended to a blockout before it runs (not to the code that seeds the
 * implement step): drop marching-cubes specks. The best organizer concept in
 * a test round was rejected over two 237 mm^3 islands beside a 31,565 mm^3
 * body; in a concept picture those are noise. Real second bodies still fail
 * (largest_body leaves them alone). Guarded, because a sidecar deployed
 * before largest_body existed would otherwise NameError every blockout.
 */
export const BLOCKOUT_EPILOGUE = `

try:
    result = largest_body(result)
except NameError:
    pass
`;

/** Overall size targets from the brief: the bbox spans it asserts, if any. */
export function briefSpans(brief: CadBrief | null | undefined): number[] {
  const targets = brief?.dimensionTargets ?? [];
  return targets
    .filter((t) => t.kind === "bbox_span" && typeof t.value === "number")
    .map((t) => t.value as number);
}

/**
 * Objects whose defining feature is an opening. Enclosures and boxes are
 * left out on purpose: those are closed by design.
 */
const CONTAINER_WORDS =
  /\b(organi[sz]er|compartments?|tray|bin|cup|mug|bowl|vase|planter|pot|caddy|dish|holder|container)\b/i;

export function isContainerPrompt(prompt: string): boolean {
  return CONTAINER_WORDS.test(prompt);
}

/**
 * A container blockout must open from above: at least this share of its
 * footprint's interior has to sit deep below the rim (sidecar `opening`
 * check). Measured: open organizers 0.52-0.94; closed pills, and cavities
 * that only nicked the rounded ends, 0.001-0.03.
 */
export const CONTAINER_MIN_OPEN = 0.2;

/**
 * Fallback for sidecars without the opening check: filling more than this
 * share of the bounding box means no real opening. Measured: closed pills
 * 0.60-0.72; open organizers 0.19-0.42. A sealed hollow passes this one,
 * which is why the opening check comes first.
 */
export const CONTAINER_MAX_FILL = 0.55;

/**
 * Why a blockout run can't be shown, or null when it can. Sizes are compared
 * as sorted extents against the brief's bbox spans (a blockout may be
 * oriented differently), with a loose band: a blockout is massing, not the
 * part, but a 2mm "enclosure" or a 213mm shovel in a 180mm cube is not a
 * concept of the requested object.
 */
export function blockoutProblem(
  run: CadRunResult,
  spans: number[],
  opts: { container?: boolean } = {}
): string | null {
  if (!run.ok) return run.error || "did not build a watertight solid";
  if ((run.validation.bodyCount ?? 1) !== 1) return "must be ONE connected body";
  const d = run.geometry?.dimensions;
  if (!d) return "no geometry measured";
  const ext = [d.x, d.y, d.z].sort((a, b) => b - a);
  if (ext[0] < 5) return `degenerate: largest extent ${ext[0].toFixed(1)}mm`;
  if (opts.container) {
    const SOLID_FIX =
      "Cut one pocket() per compartment with subtract(), and add no material back over them";
    const open = run.checks?.opening?.openFraction;
    const vol = run.geometry?.volume;
    if (typeof open === "number") {
      if (open < CONTAINER_MIN_OPEN) {
        return `it does not open from above (only ${Math.round(open * 100)}% of the top reaches down into a cavity): the compartments are closed over, too shallow, or only nick the sides. ${SOLID_FIX}`;
      }
    } else if (vol) {
      const fill = vol / (d.x * d.y * d.z);
      if (fill > CONTAINER_MAX_FILL) {
        return `it is a solid block (fills ${Math.round(fill * 100)}% of its bounding box): the cavities never open. ${SOLID_FIX}`;
      }
    }
  }
  if (spans.length > 0) {
    const want = [...spans].sort((a, b) => b - a);
    for (let i = 0; i < want.length && i < 3; i++) {
      const ratio = ext[i] / want[i];
      if (ratio < 0.75 || ratio > 1.25) {
        return `overall size is off: extents ${ext.map((v) => v.toFixed(0)).join(" x ")}mm, the brief asks for ${want.map((v) => v.toFixed(0)).join(" x ")}mm`;
      }
    }
  }
  return null;
}

export function exemplarHint(prompt: string): string {
  const [ex] = selectExemplars(prompt, { limit: 1, pool: exemplarPoolFor("sdf") });
  if (!ex) return "";
  return `\n\nA verified finished program for a related object (take its techniques, not its detail):\n# ${ex.title}\n${ex.lesson}\n\`\`\`python\n${ex.code}\n\`\`\``;
}

async function oneBlockout(opts: {
  prompt: string;
  direction: ConceptDirection;
  briefText: string;
  spans: number[];
  hint: string;
  signal?: AbortSignal;
}): Promise<BlockoutCandidate | null> {
  let feedback = "";
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const text = await completeText({
        system: BLOCKOUT_SYSTEM,
        prompt:
          `Object: ${opts.prompt}\n` +
          (opts.briefText ? `Brief: ${opts.briefText}\n` : "") +
          `Direction: ${opts.direction.label} — ${opts.direction.detail}\n` +
          (feedback ? `\nYour previous blockout failed: ${feedback}. Fix that.\n` : "") +
          `Write the blockout.${opts.hint}`,
        role: "blockout",
        signal: opts.signal,
      });
      const code = extractCode(text);
      const container = isContainerPrompt(opts.prompt);
      const run = await runCadCode(code + BLOCKOUT_EPILOGUE, ["stl"], opts.signal, {
        engine: "mesh",
        ...(container ? { checks: { opening: {} } } : {}),
      });
      const problem = blockoutProblem(run, opts.spans, { container });
      const png = run.renders?.threeQuarter ?? run.renderPng;
      if (!problem && png) {
        return {
          direction: opts.direction,
          code,
          img: { data: png, mediaType: "image/png", label: CONCEPT_BLOCKOUT_LABEL },
        };
      }
      feedback = problem ?? "no render";
    } catch (err) {
      if ((err as Error)?.name === "AbortError") throw err;
      logError("blockoutCandidates", err);
      return null;
    }
  }
  return null;
}

/**
 * One validated blockout per direction, in parallel. Returns only the ones
 * that passed; callers fall back to image concepts when fewer than two do.
 */
export async function blockoutCandidates(opts: {
  prompt: string;
  directions: ConceptDirection[];
  brief?: CadBrief | null;
  briefText?: string;
  signal?: AbortSignal;
}): Promise<BlockoutCandidate[]> {
  const spans = briefSpans(opts.brief);
  const hint = exemplarHint(opts.prompt);
  const results = await Promise.all(
    opts.directions.map((direction) =>
      oneBlockout({
        prompt: opts.prompt,
        direction,
        briefText: opts.briefText ?? "",
        spans,
        hint,
        signal: opts.signal,
      })
    )
  );
  return results.filter((c): c is BlockoutCandidate => c !== null);
}
