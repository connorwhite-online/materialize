import { modelForRole, planStepEnabled, briefStepEnabled } from "./models";
import { aestheticJudgeEnabled } from "./critique";
import { conceptImageEnabled } from "./concept";
import { generativeEnabled } from "./generative";
import { sessionsAvailable } from "./session-client";
import { isRunnerLive } from "./runner-client";

/**
 * Config fingerprint stamped onto every cadGenerations row: WHICH harness
 * produced this outcome. Outcomes without treatments aren't attributable —
 * a month of traffic can't answer "did the agentic path / judge / model swap
 * help?" unless each row records the configuration that ran. Env-derived
 * fields are resolved at generation time (env is global but changes between
 * deploys); `route` is the per-request router verdict the orchestrator
 * attaches to the result.
 */
export interface CadConfigFingerprint {
  v: 1;
  models: Record<string, string | null>;
  flags: {
    agentic: boolean;
    plan: boolean;
    brief: boolean;
    judge: boolean;
    concept: boolean;
    generative: boolean;
    sessions: boolean;
    runnerLive: boolean;
  };
  /** Router verdict for this request ("legacy" = kill-switch/no-sessions path). */
  route?: string;
}

export function harnessConfigFingerprint(
  route?: string
): CadConfigFingerprint {
  return {
    v: 1,
    models: {
      plan: modelForRole("plan") ?? null,
      implement: modelForRole("implement") ?? null,
      repair: modelForRole("repair") ?? null,
      critique: modelForRole("critique") ?? null,
      brief: modelForRole("brief") ?? null,
      title: modelForRole("title") ?? null,
    },
    flags: {
      agentic: process.env.CAD_AGENTIC !== "false",
      plan: planStepEnabled(),
      brief: briefStepEnabled(),
      judge: aestheticJudgeEnabled(),
      concept: conceptImageEnabled(),
      generative: generativeEnabled(),
      sessions: sessionsAvailable(),
      runnerLive: isRunnerLive(),
    },
    ...(route ? { route } : {}),
  };
}
