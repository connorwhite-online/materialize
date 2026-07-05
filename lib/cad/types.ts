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
    };

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
