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
 */

export function blockoutConceptsEnabled(): boolean {
  return process.env.CAD_CONCEPT_MODE === "blockout" && hasModelCredentials();
}

export function blockoutModel(): string {
  return process.env.CAD_MODEL_BLOCKOUT || "claude-haiku-4-5-20251001";
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

const SYSTEM = `You write quick SDF BLOCKOUTS: the massing of a product concept, not the finished part. They are rendered as concept options for a designer to pick from, so each must read clearly as its design direction AND as the requested object.

Rules:
- Output ONLY one Python code block. Start with \`from sdf_kit import *\` and \`import numpy as np\`.
- Build a field f(P) (P is an (N,3) array; negative inside). Exact signatures:
    sphere(P, center, r)            box(P, center, half)   # half = (hx,hy,hz)
    capsule(P, a, b, r)             tapered_capsule(P, a, b, ra, rb)
    spline_tube(P, points, radii)   # one radius per point
    cyl_z(P, x, y, r, z0, z1)       sq_prism(P, a, b, n, z0, z1)   # superellipse plan
    superellipsoid(P, center, (a, b, c), n, m)
    smin(a, b, k)  smax(a, b, k)  union(a, b)  subtract(d, hole)  offset_field(a, d)
  Combinators take distance arrays or field functions. For a custom section
  (e.g. a rounded-rectangle bar) compute it with numpy from P directly.
- ONE connected body. Get the REAL overall dimensions (mm) and proportions right.
- KEEP the features that make it recognizable as the object: an organizer's compartments, a cup's opening, a hook's prongs, an enclosure's split line, a tool's handle. A closed blob is not a concept of a container.
- Skip only SMALL functional detail: screw holes, pins, text, clearance gaps.
- CUTTING: smin/union ADD material. To remove it use subtract(body, cavity), or smax(body, -cavity, k) for a soft rim. An open container's cavity must extend ABOVE the rim so it breaks through the top; a closed hollow reads as a solid blob. Dividers are what's left BETWEEN separate cavities: cut one cavity per compartment rather than adding walls to a cavity.
- Product limbs get a designed cross-section, not a round tube. smin at junctions, union along chains. Mating faces are flat.
- Orient it as the object is used (what sits on a table sits on z=0; what mounts on a wall has its back on a plane).
- Mesh coarsely: result = to_mesh(f, lo, hi, pitch) with pitch about 1/60 of the largest dimension (min 0.6). Assign \`result\`.
- Keep it under 50 lines.`;

/** Overall size targets from the brief: the bbox spans it asserts, if any. */
export function briefSpans(brief: CadBrief | null | undefined): number[] {
  const targets = brief?.dimensionTargets ?? [];
  return targets
    .filter((t) => t.kind === "bbox_span" && typeof t.value === "number")
    .map((t) => t.value as number);
}

/**
 * Why a blockout run can't be shown, or null when it can. Sizes are compared
 * as sorted extents against the brief's bbox spans (a blockout may be
 * oriented differently), with a loose band: a blockout is massing, not the
 * part, but a 2mm "enclosure" or a 213mm shovel in a 180mm cube is not a
 * concept of the requested object.
 */
export function blockoutProblem(run: CadRunResult, spans: number[]): string | null {
  if (!run.ok) return run.error || "did not build a watertight solid";
  if ((run.validation.bodyCount ?? 1) !== 1) return "must be ONE connected body";
  const d = run.geometry?.dimensions;
  if (!d) return "no geometry measured";
  const ext = [d.x, d.y, d.z].sort((a, b) => b - a);
  if (ext[0] < 5) return `degenerate: largest extent ${ext[0].toFixed(1)}mm`;
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

function exemplarHint(prompt: string): string {
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
        system: SYSTEM,
        prompt:
          `Object: ${opts.prompt}\n` +
          (opts.briefText ? `Brief: ${opts.briefText}\n` : "") +
          `Direction: ${opts.direction.label} — ${opts.direction.detail}\n` +
          (feedback ? `\nYour previous blockout failed: ${feedback}. Fix that.\n` : "") +
          `Write the blockout.${opts.hint}`,
        model: blockoutModel(),
        role: "concept-blockout",
        signal: opts.signal,
      });
      const code = extractCode(text);
      const run = await runCadCode(code, ["stl"], opts.signal, { engine: "mesh" });
      const problem = blockoutProblem(run, opts.spans);
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
