import "server-only";

import { clerkClient } from "@clerk/nextjs/server";

import { db } from "@/lib/db";
import { cadGenerations } from "@/lib/db/schema";
import { canUseTextToCad } from "@/lib/features";
import { primaryEmail, type ClerkUserLike } from "@/lib/clerk-email";
import { engineFor, type CadEngineId } from "@/lib/cad/engines";
import {
  exemplarEngine,
  exemplarPoolFor,
  selectExemplars,
} from "@/lib/cad/knowledge/exemplars";
import { MULTI_PROCESS_SAFE } from "@/lib/cad/knowledge/dfm";
import { runCadCode } from "@/lib/cad/runner-client";
import {
  persistGenerationFailure,
  persistGenerationSuccess,
} from "@/lib/cad/persist";
import type { CadRunResult } from "@/lib/cad/types";
import type { HarnessResult } from "@/lib/cad/harness";
import { checkCadGenerateRateLimit } from "@/app/api/cad/generate/rate-limit";

/**
 * CAD tools for MCP agents: the agent writes the program, Materialize runs
 * it. An agent connected over MCP is already a model, so these tools don't
 * call one. They expose what the agent can't do itself: execute on the
 * geometry sidecar, check the result (validity, dimensions, printability),
 * render it, and save it as a studio build.
 *
 * The sidecar executes arbitrary Python. The container is the trust
 * boundary, but until its lockfile is hashed and egress is locked down (see
 * cad-runner/requirements.txt) these tools are OWNER-ONLY: the same
 * canUseTextToCad allowlist as the studio, checked on every call, on top of
 * the `cad:build` token scope.
 */

/** Largest program accepted, matching the studio's own generations. */
export const MAX_CAD_CODE_CHARS = 100_000;

export class CadAccessError extends Error {}

export async function assertCadAccess(userId: string): Promise<void> {
  const client = await clerkClient();
  const user = (await client.users.getUser(userId)) as ClerkUserLike;
  if (!canUseTextToCad(primaryEmail(user))) {
    throw new CadAccessError("CAD tools are not available for this account");
  }
}

/** The engine's own system prompt and the closest verified exemplars. */
export function cadReference(engine: CadEngineId, query: string, limit = 3) {
  const profile = engineFor(engine);
  const pool = exemplarPoolFor(engine, { prompt: query });
  const exemplars = selectExemplars(query, { limit, pool }).map((e) => ({
    id: e.id,
    title: e.title,
    engine: exemplarEngine(e),
    lesson: e.lesson,
    code: e.code,
  }));
  return {
    engine: profile.id,
    label: profile.label,
    sidecarEngine: profile.sidecarEngine,
    outputs: profile.outputFormats,
    guide: profile.systemPrompt(query),
    exemplars,
  };
}

/** Run a program on the sidecar with printability checks. */
export async function runCadForAgent(
  code: string,
  engine: CadEngineId
): Promise<CadRunResult> {
  const profile = engineFor(engine);
  return runCadCode(code, profile.outputFormats, undefined, {
    engine: profile.sidecarEngine,
    checks: { dfm: { minWall: MULTI_PROCESS_SAFE.minWallMm } },
  });
}

/** The parts of a run an agent needs, without the base64 file payloads. */
export function summarizeRun(run: CadRunResult) {
  const dfm = run.checks?.dfm;
  return {
    ok: run.ok,
    error: run.error ?? null,
    validation: run.validation,
    dimensionsMm: run.geometry?.dimensions ?? null,
    parts: (run.parts ?? []).map((p) => ({
      name: p.name,
      dimensionsMm: p.geometry?.dimensions ?? null,
      validation: p.validation,
      error: p.error ?? null,
    })),
    printability: dfm
      ? {
          ok: dfm.ok ?? null,
          minWallMm: dfm.minWallMm ?? null,
          minWallTargetMm: MULTI_PROCESS_SAFE.minWallMm,
          overhangFraction: dfm.overhangFraction ?? null,
          trappedVoidCount: dfm.trappedVoidCount ?? null,
        }
      : null,
  };
}

/** Render views worth showing an agent, as PNG base64. */
export function runRenders(run: CadRunResult, max = 3): { view: string; png: string }[] {
  const renders = run.renders ?? {};
  const order = ["threeQuarter", "threeQuarterBack", "front", "side", "top", "section"];
  const out: { view: string; png: string }[] = [];
  for (const view of order) {
    const png = (renders as Record<string, string | undefined>)[view];
    if (png) out.push({ view, png });
    if (out.length >= max) break;
  }
  if (out.length === 0 && run.renderPng) out.push({ view: "threeQuarter", png: run.renderPng });
  return out;
}

export type SaveCadResult =
  | { ok: true; generationId: string; title: string | null; fileSlug: string | null; projectSlug: string | null }
  | { ok: false; error: string; run?: CadRunResult };

/**
 * Run and save as a studio build (a root generation with its own thread),
 * the same path template builds take. A failed run is recorded as a failed
 * generation, never silently dropped.
 */
export async function saveCadForAgent(opts: {
  userId: string;
  code: string;
  engine: CadEngineId;
  name: string;
  prompt: string;
}): Promise<SaveCadResult> {
  const rate = await checkCadGenerateRateLimit(opts.userId);
  if (!rate.ok) return { ok: false, error: "Rate limited; try again shortly" };

  const profile = engineFor(opts.engine);
  const [row] = await db
    .insert(cadGenerations)
    .values({
      userId: opts.userId,
      prompt: opts.prompt,
      engine: profile.storedEngine,
      status: "pending",
    })
    .returning({ id: cadGenerations.id });

  const run = await runCadForAgent(opts.code, opts.engine);
  if (!run.ok) {
    await persistGenerationFailure(row.id, run.error || "Build failed.", opts.code, 1);
    return { ok: false, error: run.error || "Build failed.", run };
  }
  const result: HarnessResult = {
    ok: true,
    sourceCode: opts.code,
    attempts: 1,
    run,
    route: `mcp-agent-${profile.id}`,
  };
  const persisted = await persistGenerationSuccess({
    userId: opts.userId,
    generationId: row.id,
    prompt: opts.prompt,
    isRoot: true,
    nameOverride: opts.name,
    result,
  });
  if ("error" in persisted) return { ok: false, error: persisted.error };
  return {
    ok: true,
    generationId: persisted.generationId,
    title: persisted.title ?? opts.name,
    fileSlug: persisted.fileSlug ?? null,
    projectSlug: persisted.projectSlug ?? null,
  };
}
