import "server-only";

import { activeCadContext, meterSidecarCall } from "./metering";
import { sidecarDispatcher } from "./sidecar-fetch";
import type { CadOutputFormat, CadRunResult } from "./types";

/**
 * Client for the sidecar's stateful session mode (docs/text-to-cad/03 §A) — a
 * persistent Python namespace with build123d/sdf_kit warmed, so the agentic
 * loop can build a part incrementally instead of regenerating the whole
 * script per attempt.
 *
 * Unlike runner-client, there is NO mock mode: a session without a real
 * kernel is meaningless. When CAD_RUNNER_URL is unset (or the runner is
 * forced to mock), `sessionsAvailable()` is false and the orchestrator keeps
 * everything on the classic one-shot path.
 *
 * Transport failures throw CadSessionError so callers can tell "the
 * infrastructure broke" (fall back to runHarness) apart from "the exec'd code
 * failed" (a normal tool result the agent repairs).
 */

/** Infrastructure-level session failure (unreachable, bad status, bad JSON). */
export class CadSessionError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "CadSessionError";
  }
}

/** True when a real sidecar is configured — sessions have no mock mode. */
export function sessionsAvailable(): boolean {
  return (
    !!process.env.CAD_RUNNER_URL &&
    process.env.CAD_RUNNER_USE_MOCK !== "true"
  );
}

function headers(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    // SEC-4 — sent unconditionally, not gated on the var being set.
    // See the matching comment in runner-client.ts: lib/env.ts's boot
    // validation requires CAD_RUNNER_SECRET whenever CAD_RUNNER_URL is
    // live, and sessionFetch (the only caller of headers()) already
    // refuses to run when sessions aren't available.
    Authorization: `Bearer ${process.env.CAD_RUNNER_SECRET ?? ""}`,
  };
}

async function sessionFetch<T>(
  path: string,
  init: { method: string; body?: unknown; signal?: AbortSignal }
): Promise<T> {
  const base = process.env.CAD_RUNNER_URL;
  if (!sessionsAvailable() || !base) {
    throw new CadSessionError("CAD sessions unavailable (no CAD_RUNNER_URL)");
  }
  // Cost metering (MTR-181): session calls are sidecar wall time too —
  // recorded however the request ends (no-op outside a metered generation).
  const started = Date.now();
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, {
      method: init.method,
      headers: headers(),
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: init.signal,
      // Outlive the sidecar's exec ceiling — undici's default 300s headers
      // timeout killed long session execs at the HTTP layer mid-build.
      // Not in RequestInit's types, but honored by Node's fetch.
      ...({ dispatcher: sidecarDispatcher } as object),
    });
  } catch (err) {
    // Preserve aborts (caller cancellation, not infrastructure failure).
    if ((err as Error)?.name === "AbortError") throw err;
    throw new CadSessionError(`CAD session request failed: ${path}`, {
      cause: err,
    });
  } finally {
    meterSidecarCall(Date.now() - started);
  }
  if (!res.ok) {
    throw new CadSessionError(
      `CAD session error ${res.status} on ${path}: ${await res.text().catch(() => "")}`
    );
  }
  try {
    return (await res.json()) as T;
  } catch (err) {
    throw new CadSessionError(`CAD session returned non-JSON on ${path}`, {
      cause: err,
    });
  }
}

/**
 * Exec result: when the code assigned/updated `result` or `parts`, the same
 * payload as /run (CadRunResult) plus stdout + a namespace summary; otherwise
 * just the ok/stdout/namespace triple.
 */
export type SessionExecResult =
  | (CadRunResult & { stdout: string; namespace: string[] })
  | { ok: true; stdout: string; namespace: string[] };

/** Narrow an exec result to the "produced/updated a solid" shape. */
export function execProducedRun(
  r: SessionExecResult
): r is CadRunResult & { stdout: string; namespace: string[] } {
  return "validation" in r;
}

export async function createSession(opts?: {
  engine?: string;
  signal?: AbortSignal;
}): Promise<string> {
  const res = await sessionFetch<{ sessionId: string }>("/session", {
    method: "POST",
    body: opts?.engine ? { engine: opts.engine } : {},
    signal: opts?.signal,
  });
  if (!res.sessionId) throw new CadSessionError("session create returned no id");
  return res.sessionId;
}

export async function execInSession(
  sessionId: string,
  code: string,
  opts?: {
    formats?: CadOutputFormat[];
    allowRemesh?: boolean;
    signal?: AbortSignal;
  }
): Promise<SessionExecResult> {
  const result = await sessionFetch<SessionExecResult>(
    `/session/${sessionId}/exec`,
    {
      method: "POST",
      body: {
        code,
        ...(opts?.formats ? { formats: opts.formats } : {}),
        allowRemesh: opts?.allowRemesh ?? false,
      },
      signal: opts?.signal,
    }
  );
  // Flight recorder (lib/cad/transcript.ts): agentic execs are the attempts
  // of a complex build — code + verdict + render into the job transcript.
  activeCadContext()?.recorder?.recordExec({
    source: "session",
    code,
    ok: result.ok,
    error: execProducedRun(result) ? result.error : undefined,
    validation: execProducedRun(result) ? result.validation : undefined,
    render: execProducedRun(result) ? result.renderPng : undefined,
  });
  return result;
}

/** Bounding box the sidecar reports for an imported STEP (mm). */
export interface ImportStepResult {
  ok: boolean;
  name?: string;
  byteSize?: number;
  boundingBox?: {
    min: [number, number, number];
    max: [number, number, number];
    size: [number, number, number];
  } | null;
  namespace?: string[];
  error?: string;
}

/**
 * Import a fetched STEP (base64) into the session namespace under `name`
 * (MTR-200). The sidecar returns the imported part's bounding box so the
 * caller derives mating frames from geometry, never from the arbitrary STEP
 * origin. DOCKER-VERIFIED: needs OCP/build123d import_step, which the dev/test
 * env lacks — callers must failure-isolate.
 */
export async function importStepIntoSession(
  sessionId: string,
  stepB64: string,
  name = "part",
  signal?: AbortSignal
): Promise<ImportStepResult> {
  return sessionFetch<ImportStepResult>(`/session/${sessionId}/import_step`, {
    method: "POST",
    body: { stepB64, name },
    signal,
  });
}

export async function snapshotSession(
  sessionId: string,
  signal?: AbortSignal
): Promise<void> {
  await sessionFetch<{ ok: boolean }>(`/session/${sessionId}/snapshot`, {
    method: "POST",
    signal,
  });
}

export async function rollbackSession(
  sessionId: string,
  signal?: AbortSignal
): Promise<void> {
  await sessionFetch<{ ok: boolean }>(`/session/${sessionId}/rollback`, {
    method: "POST",
    signal,
  });
}

export async function deleteSession(
  sessionId: string,
  signal?: AbortSignal
): Promise<void> {
  await sessionFetch<{ ok: boolean }>(`/session/${sessionId}`, {
    method: "DELETE",
    signal,
  });
}
