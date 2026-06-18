import type { CadRunResult } from "./types";

/**
 * Pure (non-server-only) text-to-CAD helpers shared by the harness
 * (lib/cad/harness.ts) and the eval runner (scripts/evals). Kept free of
 * `server-only` so a plain tsx script can import it.
 */

export const SYSTEM_PROMPT = `You are a CAD engineer that writes parametric 3D models as build123d Python code.

Rules:
- Output ONLY a single Python code block. No prose before or after.
- Use the build123d library (\`from build123d import *\`).
- Assign the final solid to a variable named \`result\`.
- Make it PARAMETRIC: declare key dimensions as named variables at the top so they can be tuned later.
- Design for 3D printing: a flat base where sensible, no zero-thickness walls, reasonable minimum wall thickness (>= 1.5 mm), units in millimeters.
- Keep it a single watertight solid unless the prompt clearly asks for separate parts.
- When the request clearly needs SEPARATE printed parts (e.g. a two-piece enclosure = lid + base, or a hinge with two halves), assign a dict named \`parts\` INSTEAD of \`result\` — e.g. \`parts = {"lid": <solid>, "base": <solid>}\`, one entry per independently-printed part, each its own watertight solid. Use \`result\` for everything else; never assign both.
- Do not call show_object, export, or any file I/O — just build \`result\`.
- Target the build123d 0.11+ API: for a symmetric/two-sided extrude use \`extrude(..., both=True)\` (there is no \`symmetric=\` argument).`;

/**
 * Plan-then-code: the harness first asks for a short design plan (no code),
 * then feeds it into the implementation step. Decomposition/CoT measurably
 * improves the resulting build123d, especially for non-trivial parts — and the
 * "plan" role is the natural seam a specialized model could fill later.
 */
export const PLAN_SYSTEM_PROMPT = `You are a CAD engineer PLANNING a parametric build123d model before any code is written. Output a SHORT plan (about 5-10 lines, NO code):
- the key named dimensions and their values (mm)
- the base shape and the ordered operations (extrude / revolve / loft / shell / fillet / chamfer / holes / patterns)
- which edges get fillets vs chamfers, and the small radius family to reuse
- printability notes for the target process (walls, overhangs, drain/escape holes, base chamfer)
Honor the design guidance you are given. Be concrete and terse. Do NOT write build123d code.`;

/** Pull the first fenced code block out of a model response, else return as-is. */
export function extractCode(text: string): string {
  const fenced = text.match(/```(?:python|py)?\s*\n([\s\S]*?)```/i);
  return (fenced ? fenced[1] : text).trim();
}

export interface ExpectedDims {
  x?: number;
  y?: number;
  z?: number;
}

export interface RunGrade {
  /** Valid AND (when expected dims given) dimensionally on-target. */
  pass: boolean;
  failures: string[];
  /** null when no expected dims were provided. */
  dimsOk: boolean | null;
}

/**
 * The cheap, objective part of the manufacturability oracle: validity
 * flags from the sidecar + (optionally) a dimensional-accuracy check
 * against numbers the prompt asked for.
 */
export function gradeRun(
  run: CadRunResult,
  expectedDims?: ExpectedDims | null,
  tolMm = 2
): RunGrade {
  const failures: string[] = [];
  if (!run.validation.compiled) failures.push("did not compile/run");
  if (!run.validation.isSolid) failures.push("not a solid");
  if (!run.validation.isWatertight) failures.push("not watertight");
  if (!run.validation.isManifold) failures.push("non-manifold");
  if (run.error) failures.push(`error: ${run.error}`);

  let dimsOk: boolean | null = null;
  const d = run.geometry?.dimensions;
  if (expectedDims && d) {
    const within = (got: number, want?: number) =>
      want == null ? true : Math.abs(got - want) <= tolMm;
    dimsOk =
      within(d.x, expectedDims.x) &&
      within(d.y, expectedDims.y) &&
      within(d.z, expectedDims.z);
    if (!dimsOk) failures.push("dimensions off target");
  }

  return { pass: run.ok && failures.length === 0, failures, dimsOk };
}
