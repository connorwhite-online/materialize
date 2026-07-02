import "server-only";

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
    ...(process.env.CAD_RUNNER_SECRET
      ? { Authorization: `Bearer ${process.env.CAD_RUNNER_SECRET}` }
      : {}),
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
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, {
      method: init.method,
      headers: headers(),
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: init.signal,
    });
  } catch (err) {
    // Preserve aborts (caller cancellation, not infrastructure failure).
    if ((err as Error)?.name === "AbortError") throw err;
    throw new CadSessionError(`CAD session request failed: ${path}`, {
      cause: err,
    });
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
  return sessionFetch<SessionExecResult>(`/session/${sessionId}/exec`, {
    method: "POST",
    body: {
      code,
      ...(opts?.formats ? { formats: opts.formats } : {}),
      allowRemesh: opts?.allowRemesh ?? false,
    },
    signal: opts?.signal,
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
