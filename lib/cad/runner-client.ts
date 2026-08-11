import "server-only";

import { activeCadContext, meterSidecarCall } from "./metering";
import { sidecarDispatcher } from "./sidecar-fetch";
import type { CadOutputFormat, CadRunResult } from "./types";

/**
 * Client for the CAD execution sidecar — a separate, isolated service
 * (Python + build123d on the OpenCASCADE kernel) that runs a generated
 * CAD script and returns the exported files, a preview render, geometry
 * stats, and validity flags.
 *
 * Executing generated code on Vercel's serverless runtime isn't viable
 * (no kernel binary, no long-lived process), so this always talks to an
 * external `CAD_RUNNER_URL` over HTTP — same shape as lib/craftcloud/client.ts.
 *
 * Mock mode is ON whenever no sidecar URL is configured, so the app boots
 * and the whole text-to-CAD -> print pipeline can be exercised locally
 * without standing up the sidecar. Setting CAD_RUNNER_URL switches to live
 * automatically; set CAD_RUNNER_USE_MOCK=true to force the mock even with a
 * URL present (e.g. CI). The mock returns a tiny valid empty-mesh STL and a
 * 1x1 PNG; bytes content is irrelevant downstream in mock mode (CraftCloud
 * is also mocked by default).
 */

const RUNNER_URL = process.env.CAD_RUNNER_URL ?? "";
const USE_MOCK = RUNNER_URL === "" || process.env.CAD_RUNNER_USE_MOCK === "true";

// 1x1 transparent PNG, base64 (no data: prefix).
const MOCK_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

/** A valid, empty (0-triangle) binary STL: 80-byte header + uint32 count=0. */
function mockStlBase64(): string {
  return Buffer.from(new Uint8Array(84)).toString("base64");
}

function mockRun(): CadRunResult {
  return {
    ok: true,
    files: {
      stl: mockStlBase64(),
      step: Buffer.from("ISO-10303-21; /* mock STEP */").toString("base64"),
    },
    renderPng: MOCK_PNG_BASE64,
    geometry: {
      dimensions: { x: 20, y: 20, z: 20 },
      volume: 8000,
      triangleCount: 12,
    },
    validation: {
      compiled: true,
      isSolid: true,
      isWatertight: true,
      isManifold: true,
    },
  };
}

/** Per-run options forwarded to the sidecar. */
export interface RunCadCodeOptions {
  /**
   * Permit the sidecar's lossy voxel-remesh fallback for a non-watertight
   * result. Default false: the harness gets the failure diagnosis and decides
   * (repair turn, or an explicit last-attempt retry with allowRemesh: true) —
   * the remesh must be a recorded decision, never a silent trade
   * (docs/text-to-cad/02 §C). Older sidecars ignore the flag (always remesh).
   */
  allowRemesh?: boolean;
  /** Code dialect for the sidecar ("build123d" default | "cadquery"). */
  engine?: string;
  /**
   * Post-export checks to run on the produced mesh (sidecar `checks` field):
   * `{ fit }` for the MTR-204 component-fit verifier, `{ networks, fea }` for
   * MTR-179/180 probes. Failure-isolated sidecar-side; older sidecars ignore
   * it. Omitted (not sent) when absent.
   */
  checks?: Record<string, unknown> | null;
}

/**
 * Execute a CAD script in the sidecar and return the result. Never throws
 * for an expected compile/validation failure — those come back as
 * `{ ok: false, error }` so the harness can feed the error into a repair
 * turn. Only throws on transport-level failure (sidecar unreachable).
 */
export async function runCadCode(
  code: string,
  formats: CadOutputFormat[] = ["stl", "step", "topo"],
  signal?: AbortSignal,
  opts?: RunCadCodeOptions
): Promise<CadRunResult> {
  if (USE_MOCK) return mockRun();

  // Cost metering (MTR-181): sidecar wall time is a real marginal cost —
  // record it into the active meter (no-op outside a metered generation).
  const started = Date.now();
  try {
    const run = await runCadCodeLive(code, formats, signal, opts);
    // Flight recorder (lib/cad/transcript.ts): code + verdict + render for
    // the persisted job transcript. Observation-only, never throws the run.
    activeCadContext()?.recorder?.recordExec({
      source: "runner",
      code,
      ok: run.ok,
      error: run.error,
      validation: run.validation,
      render: run.renderPng,
    });
    return run;
  } finally {
    meterSidecarCall(Date.now() - started);
  }
}

async function runCadCodeLive(
  code: string,
  formats: CadOutputFormat[],
  signal?: AbortSignal,
  opts?: RunCadCodeOptions
): Promise<CadRunResult> {
  const res = await fetch(`${RUNNER_URL}/run`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // SEC-4 — sent unconditionally, not gated on the var being set.
      // lib/env.ts's boot validation now requires CAD_RUNNER_SECRET
      // whenever CAD_RUNNER_URL is live (non-mock), so by the time
      // this code path runs the app has already refused to boot
      // without it. This function only ever reaches here in live
      // mode (USE_MOCK short-circuits above), so there's no mock-run
      // path that would send a bogus header.
      Authorization: `Bearer ${process.env.CAD_RUNNER_SECRET ?? ""}`,
    },
    body: JSON.stringify({
      code,
      formats,
      ...(opts?.engine ? { engine: opts.engine } : {}),
      ...(opts?.checks ? { checks: opts.checks } : {}),
      allowRemesh: opts?.allowRemesh ?? false,
    }),
    signal,
    // Outlive the sidecar's exec ceiling — undici's default 300s headers
    // timeout killed a finished-and-verified 438s build at the HTTP layer.
    // Not in RequestInit's types, but honored by Node's fetch.
    ...({ dispatcher: sidecarDispatcher } as object),
  });

  if (!res.ok) {
    throw new Error(`CAD runner error ${res.status}: ${await res.text()}`);
  }
  return (await res.json()) as CadRunResult;
}

/** True when a real sidecar is configured (not mock). */
export function isRunnerLive(): boolean {
  return !USE_MOCK;
}
