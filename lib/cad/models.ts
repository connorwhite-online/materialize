/**
 * Per-role model registry for the text-to-CAD harness — the "routing-ready"
 * plumbing. Each step of the harness (plan, implement, repair, critique,
 * title) resolves its model independently, so model assignments can be A/B'd
 * via env config without code changes.
 *
 * Resolution order per role: role-specific env -> global CAD_MODEL_DEFAULT ->
 * undefined (let the SDK pick its default — the strong model). So with NOTHING
 * configured, every role uses the strong default and there is no routing and
 * no quality regression. Routing to a cheaper/specialized model later is then
 * a config change, informed by the per-role telemetry the harness records.
 *
 * Pure (no `server-only`) so the eval runner and tests can use it.
 */

export type CadRole =
  | "plan"
  | "brief"
  | "implement"
  | "repair"
  | "critique"
  | "title";

const ROLE_ENV: Record<CadRole, string> = {
  plan: "CAD_MODEL_PLAN",
  brief: "CAD_MODEL_BRIEF",
  implement: "CAD_MODEL_IMPLEMENT",
  repair: "CAD_MODEL_REPAIR",
  critique: "CAD_MODEL_CRITIQUE",
  title: "CAD_MODEL_TITLE",
};

/**
 * The model id for a role, or undefined to use the SDK's default. Undefined is
 * the intended default for every role until you deliberately route.
 */
export function modelForRole(role: CadRole): string | undefined {
  return (
    process.env[ROLE_ENV[role]] ||
    process.env.CAD_MODEL_DEFAULT ||
    undefined
  );
}

/**
 * Plan-then-code: emit a short design plan before writing build123d. On by
 * default (decomposition/CoT lifts code quality); set CAD_PLAN_STEP=false to
 * skip the extra model call. No-op without model credentials regardless.
 */
export function planStepEnabled(): boolean {
  return process.env.CAD_PLAN_STEP !== "false";
}

/**
 * Design-brief step (docs/text-to-cad/06 part 1): a structured JSON
 * intermediate between prompt and code, built on fresh builds alongside the
 * plan. On by default; set CAD_BRIEF_STEP=false to skip the extra model call.
 * Best-effort regardless — a brief failure never blocks generation.
 */
export function briefStepEnabled(): boolean {
  return process.env.CAD_BRIEF_STEP !== "false";
}
