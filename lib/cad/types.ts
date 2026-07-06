/**
 * Shared types for the text-to-CAD harness and its execution sidecar.
 * Pure types — safe to import from client or server.
 */

/** Output formats the sidecar can export from a build123d script. */
export type CadOutputFormat = "stl" | "step";

/** Geometry stats the sidecar measures off the produced solid. */
export interface CadGeometry {
  dimensions?: { x: number; y: number; z: number };
  volume?: number;
  triangleCount?: number;
}

/** Validity flags — the cheap, objective part of the manufacturability oracle. */
export interface CadValidation {
  compiled: boolean;
  isSolid: boolean;
  isWatertight: boolean;
  isManifold: boolean;
  /**
   * Connected-solid count for the exported mesh (sidecar fragment gate).
   * 1 = one fused body; >1 means floating debris or un-unioned features —
   * the sidecar fails the part with a diagnosis. Absent on old payloads.
   */
  bodyCount?: number;
}

/** One member of a multi-part assembly. */
export interface CadPart {
  /** Part name from the script's `parts` dict key. */
  name: string;
  files: Partial<Record<CadOutputFormat, string>>;
  renderPng?: string;
  geometry?: CadGeometry;
  validation: CadValidation;
  /** True when this part's watertight mesh came from the voxel-remesh fallback. */
  remeshed?: boolean;
  error?: string;
}

/**
 * Named render viewpoints the sidecar can produce (docs/text-to-cad/07 §A).
 * `threeQuarterBack` is the OPPOSED isometric (MTR-199): the two opposed isos
 * guarantee every face appears in at least one image — rear/left/bottom
 * features are covered by default, not by suspicion. `section` is a mid-plane
 * cutaway, emitted only for parts with internal cavities so the judge /
 * self-review can see bores, channels, and shell interiors.
 */
export type CadRenderView =
  | "threeQuarter"
  | "threeQuarterBack"
  | "top"
  | "front"
  | "side"
  | "section";

/**
 * One sidecar fit-check verdict (MTR-204): cavity containment, boss↔hole
 * pattern match, or cutout↔port alignment, evaluated against the built mesh
 * in cad-runner/fit.py. `id` matches the requesting DimensionTarget's id.
 */
export interface CadFitCheckResult {
  id: string;
  kind?: string;
  /** Pass/fail; null when this check could not be evaluated. */
  ok: boolean | null;
  /** Measured value (air fraction, matched holes, opening found 1/0). */
  got?: number;
  /** Geometric diagnosis — becomes the repair hint on failure. */
  note?: string;
}

/** Result of executing one CAD script in the sidecar. */
export interface CadRunResult {
  ok: boolean;
  /** Base64-encoded file bytes per requested format. Present only when ok. */
  files: Partial<Record<CadOutputFormat, string>>;
  /** Base64 PNG preview render (no `data:` prefix). */
  renderPng?: string;
  /**
   * Multi-view renders keyed by viewpoint — superset of renderPng (which
   * stays the threeQuarter view for compatibility). Absent from older
   * sidecars; consumers must tolerate it missing.
   */
  renders?: Partial<Record<CadRenderView, string>>;
  geometry?: CadGeometry;
  validation: CadValidation;
  /**
   * Multi-part assembly breakdown — present when the script assigned a `parts`
   * dict instead of a single `result`. Top-level files/render/geometry mirror
   * the first part; `validation`/`ok` are the AND across all parts. The
   * persist layer bundles these into a Project (PR follow-up).
   */
  parts?: CadPart[];
  /** True when the watertight result came from the voxel-remesh fallback. */
  remeshed?: boolean;
  /**
   * Post-export checks the caller requested (sidecar `checks` request):
   * `fit` carries the MTR-204 component-fit verdicts; `networks`/`fea`
   * (MTR-179/180) pass through untyped. Absent when no checks were requested
   * or the sidecar predates them — consumers must tolerate it missing.
   */
  checks?: {
    fit?: {
      results?: CadFitCheckResult[];
      /** Voxel pitch used — the honesty bound on interference detection. */
      pitchMm?: number;
      error?: string;
    };
    [key: string]: unknown;
  };
  /** stderr / exception message when compile or export failed. */
  error?: string;
}

/**
 * Progress emitted by the harness loop, streamed to the studio so the user
 * sees what's happening (write code -> run kernel -> validate -> repair).
 * Pure data — shared by the harness (emitter), the streaming route (relay),
 * and the client (renderer), so all three agree on one contract.
 */
export type CadProgressEvent =
  | {
      /** Job accepted but not yet started (background-job mode, MTR-175). */
      type: "queued";
    }
  | {
      /**
       * Live build preview: the latest render of the in-progress solid.
       * NOT persisted in cadJobs.progress (payload size) — carried in the
       * cadJobs.lastSnapshot column and re-emitted by the events route.
       */
      type: "snapshot";
      /** Base64 PNG (no data: prefix). */
      render: string;
      /** Monotonic step counter for cheap change detection. */
      step: number;
    }
  | {
      type: "phase";
      /** `generating` = model writing code; `executing` = sidecar running it. */
      phase: "generating" | "executing";
      attempt: number;
      maxAttempts: number;
    }
  | {
      type: "validation";
      attempt: number;
      maxAttempts: number;
      pass: boolean;
      failures: string[];
      validation: CadValidation;
    }
  | {
      type: "repairing";
      /** Attempt that just failed; the next one is `attempt + 1`. */
      attempt: number;
      maxAttempts: number;
      reason: string;
    }
  | {
      /**
       * Mid-cycle clarifying question (MTR-191): the executor flipped the job
       * to `awaiting_input`, emitted this, and is polling cadJobs.answers for
       * the pick. Options may carry base64 thumbnails (visual draft-form
       * variants). Answered via POST /api/cad/jobs/[jobId]/answer; ignored, the
       * executor proceeds with `defaultOptionId` after `timeoutS`.
       */
      type: "question";
      questionId: string;
      text: string;
      options: CadQuestionOption[];
      defaultOptionId?: string;
      timeoutS: number;
    }
  | {
      /**
       * Resolution of a `question` (MTR-191): the user's pick, or the default
       * taken on timeout (`viaDefault`). Recorded in the progress log so the
       * Q/A pair stays visible in thread history and survives replay.
       */
      type: "answer";
      questionId: string;
      optionId: string;
      label: string;
      viaDefault: boolean;
    };

/**
 * One selectable answer to a mid-cycle question (MTR-191). `thumbnail` carries
 * a base64 PNG (no `data:` prefix) for the visual-variant case — cheap draft
 * forms the user picks between as silhouettes rather than words.
 */
export interface CadQuestionOption {
  id: string;
  label: string;
  detail?: string;
  thumbnail?: string;
}

/**
 * A focused multiple-choice question the harness pauses to ask mid-generation
 * (MTR-191). The executor emits it as a `question` progress event, flips the
 * job to `awaiting_input`, and polls `cadJobs.answers` for the pick.
 */
export interface CadQuestion {
  id: string;
  text: string;
  options: CadQuestionOption[];
  /** Option id taken when the user doesn't answer before the timeout. */
  defaultOptionId?: string;
  /** Seconds the executor waits before proceeding with the default. */
  timeoutS?: number;
}

/**
 * Callback the executor hands the harness so a running build can SUSPEND, ask
 * the user one multiple-choice question, and RESUME with the chosen option id
 * (MTR-191, riding MTR-175's resumable job). Resolves to the selected option
 * id (or the default on timeout). Absent for legacy callers and secondary
 * best-of candidates — the harness then proceeds with its own judgment instead
 * of pausing, so asking is always optional.
 */
export type CadQuestionAsker = (question: CadQuestion) => Promise<string>;

/** Terminal payload the streaming route appends after the harness finishes. */
export interface CadDoneEvent {
  type: "done";
  generationId: string;
  fileAssetId: string;
  fileSlug: string;
  renderUrl: string | null;
  sourceCode: string;
  /** Thread title — non-null only for a thread's first (root) generation. */
  title: string | null;
  /** Present (length > 1) when the result was a multi-part assembly. */
  parts?: { name: string; fileAssetId: string; fileSlug: string }[];
  /** Slug of the Project bundling an assembly's parts, when created. */
  projectSlug?: string | null;
  /** True when the result was voxel-remeshed (an approximation). */
  remeshed?: boolean;
}

/** Full event union carried over the SSE stream from /api/cad/generate. */
export type CadStreamEvent =
  | CadProgressEvent
  | CadDoneEvent
  | { type: "error"; error: string; generationId?: string };

/**
 * One entry persisted in cadJobs.progress (MTR-175): every CadProgressEvent
 * the harness emitted plus exactly one terminal record (`done` or `error`)
 * appended when the job finishes. Same wire shapes as the SSE stream — the
 * events route (/api/cad/jobs/[jobId]/events) replays these verbatim, so
 * CadProgressEvent / CadDoneEvent stay backward compatible by construction.
 */
export type CadJobProgressEntry = CadStreamEvent;

// --- Generation cost metering (MTR-181) ------------------------------------
//
// RAW usage signals captured per generation job and persisted on
// cadJobs.usage. Deliberately raw (token counts per role+model, sidecar wall
// time, fal invocations) rather than a single number, so unit-price changes
// re-compute cost from history instead of freezing yesterday's prices into
// the data. The cents rollup lives beside it in cadJobs.costCents as a
// point-in-time snapshot; lib/billing/cad-pricing.ts recomputes from this.

/** Aggregated Messages-API usage for one (role, model) pair within a job. */
export interface CadModelUsage {
  /** Harness role that made the calls ("plan", "implement", "agentic", …). */
  role: string;
  /** Resolved model id the API reported (or the requested id as fallback). */
  model: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  /** Total wall time spent in these calls (ms). */
  ms: number;
}

/** Aggregated fal.ai invocations for one fal model within a job. */
export interface CadFalUsage {
  model: string;
  calls: number;
  ms: number;
}

/** The persisted per-job usage record (cadJobs.usage). */
export interface CadUsageSummary {
  v: 1;
  model: CadModelUsage[];
  /** Sidecar wall time: every /run + session call the job made. */
  sidecar: { calls: number; ms: number };
  fal: CadFalUsage[];
  /** Router verdict for the job (mirrors HarnessResult.route), when known. */
  route?: string;
}
