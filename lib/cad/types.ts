/**
 * Shared types for the text-to-CAD harness and its execution sidecar.
 * Pure types — safe to import from client or server.
 */

import type { DimensionCheckResult } from "./dimension-check";

/** Output formats the sidecar can export from a build123d script. */
export type CadOutputFormat = "stl" | "step" | "topo";

/**
 * Formats requested for every B-rep generation (harness / agentic / template
 * / param-rerun). `"topo"` unlocks exact face picking + feature-chip
 * highlight (MTR-174 substrate); mesh-mode runs ignore it.
 */
export const BREP_OUTPUT_FORMATS: CadOutputFormat[] = ["stl", "step", "topo"];

/**
 * One construction operation the sidecar instrumented during a B-rep run
 * (feature chips / construction-history UX). `faceIds` index the same
 * `topo.faces` list the viewer uses for exact picking; empty when topo
 * wasn't produced or the op's faces didn't survive to the final solid.
 */
export type CadFeatureOp =
  | "extrude"
  | "fillet"
  | "chamfer"
  | "loft"
  | "revolve"
  | "shell"
  | "hole"
  | "boolean"
  | "other";

export interface CadFeature {
  /** Stable within this generation (e.g. "fillet-0"). */
  id: string;
  op: CadFeatureOp;
  /** Short UI label, e.g. "Fillet r=2.4". */
  label: string;
  /** Numeric values bound to this op when known (radius, amount, …). */
  params: Record<string, number>;
  /**
   * Maps a control key in `params` → a top-level source parameter name
   * (`fillet_r`) so Reset/Update can rewrite the script without an LLM.
   */
  paramNames?: Record<string, string>;
  /** Indices into `topo.faces` for highlight. */
  faceIds: number[];
  /**
   * 1-based inclusive source-line range of the statement that executed this
   * op (MTR-225). Enables span-literal param edits and statement-scoped
   * repair; absent when the sidecar couldn't resolve it.
   */
  span?: [number, number];
}

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

/**
 * Dual-fluid isolation verdict (networks.py `check_networks`, MTR-179).
 * Verified at voxel resolution: `isolated: true` means "no leak path wider
 * than ~pitch mm" — surface copy must state that bound, never "leak-free".
 */
export interface CadNetworksReport {
  /** Voxel pitch used (mm) — the honesty bound on leak width. */
  pitch?: number;
  /** Void components touching any declared port. */
  components?: number;
  /** Port name -> void component id; null = the probe found no void. */
  ports?: Record<string, number | null>;
  /**
   * True when every port resolved, each circuit prefix (`a_...`/`b_...`)
   * owns exactly one void component, and no component hosts two circuits.
   */
  isolated?: boolean;
  /** Thinnest solid separation between circuits, in voxels (null = ample). */
  minWallVoxels?: number | null;
  /** Port bores virtually refilled before flood-fill (open-port parts). */
  plugs?: number;
  /**
   * The part is too large for a probe fine enough to resolve its declared
   * minimum feature (fluid_min_feature) — NO verdict was rendered. "Not
   * verified", never "leaked": a verdict at that resolution would alias
   * sound walls into phantom leaks.
   */
  inconclusive?: boolean;
  /** Why the check was inconclusive (resolution vs voxel budget). */
  reason?: string;
  /** The check itself failed to run. */
  error?: string;
}

/** Result of executing one CAD script in the sidecar. */
export interface CadRunResult {
  ok: boolean;
  /** Base64-encoded file bytes per requested format. Present only when ok. */
  files: Partial<Record<CadOutputFormat, string>>;
  /**
   * Present when the exported STL was slimmed to fit the output cap (large
   * TPMS meshes): validation/geometry describe the FULL mesh, the shipped
   * file is the reduced one. method "quadric" = detail-preserving
   * decimation; "voxel" = occupancy remesh at `pitch` mm (guaranteed
   * watertight, ~pitch of surface detail lost).
   */
  decimatedForExport?: {
    fromTriangles: number;
    toTriangles: number;
    method: "quadric" | "voxel";
    pitch?: number;
  };
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
   * B-rep topology manifest (MTR-174) when `"topo"` was requested and the
   * sidecar succeeded. Absent on mesh-mode / older sidecars / export failure
   * — consumers must tolerate it missing (fall back to mesh flood-fill).
   */
  topo?: unknown;
  /**
   * Instrumented construction features for the feature-chip UX. Present on
   * B-rep runs when the sidecar wrapped ops; empty/absent otherwise.
   */
  features?: CadFeature[];
  /**
   * Post-export checks (sidecar `checks` request, or auto-triggered by the
   * script — `fluid_ports` requests `networks` without any caller wiring):
   * `fit` carries the MTR-204 component-fit verdicts; `networks` the
   * dual-fluid isolation verdict; `fea` (MTR-180) passes through untyped.
   * Absent when no checks ran or the sidecar predates them — consumers must
   * tolerate it missing.
   */
  checks?: {
    fit?: {
      results?: CadFitCheckResult[];
      /** Voxel pitch used — the honesty bound on interference detection. */
      pitchMm?: number;
      error?: string;
    };
    networks?: CadNetworksReport;
    /**
     * Scan-fit verdicts (containment / retention / extraction) when the run
     * requested them. `ok: null` on a result means the check could not be
     * evaluated — honest-not-run, never a silent pass.
     */
    scanFit?: {
      results?: CadFitCheckResult[];
      pitchMm?: number;
      error?: string;
    };
    [key: string]: unknown;
  };
  /**
   * Per-attachment proxy derivation reports, keyed by the name the proxy was
   * bound to. Carries the level actually used, the closed size, and every
   * degradation the ladder had to make — so a scan that could only be reduced
   * to its convex hull says so instead of quietly pretending otherwise.
   */
  scans?: Record<string, CadScanReport>;
  /** stderr / exception message when compile or export failed. */
  error?: string;
}

/** One scan's proxy derivation report (cad-runner/scan_proxy.py). */
export interface CadScanReport {
  name?: string;
  level?: string;
  requestedLevel?: string;
  clearanceMm?: number;
  sizeMm?: number[];
  bboxMm?: { min: number[]; max: number[] };
  volumeMm3?: number;
  watertight?: boolean;
  bottomCapped?: boolean;
  capMethod?: string;
  groundPlane?: string;
  inputTriangles?: number;
  proxyTriangles?: number;
  decimated?: { from: number; to: number; error?: string };
  warnings?: string[];
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
      /**
       * Sampled surface points of the in-progress solid (base64 LE Float32
       * xyz triples, model space — see lib/cad/stl-points.ts). Optional and
       * fail-open: absent when the STL wasn't parsable or the run predates
       * this field. Drives the studio's live point-cloud morph.
       */
      points?: string;
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
    }
  | {
      /**
       * Observability: which engine the router picked ("complex" = agentic,
       * "simple"/"legacy" = scripted, "organic" = generative, …). Emitted
       * once per job when the verdict is known, so the persisted progress
       * trail records how the build actually ran.
       */
      type: "route";
      route: string;
    }
  | {
      /**
       * Observability: an engine failed mid-run and the orchestrator fell
       * back (e.g. agentic session died -> scripted rebuild). Without this
       * the progress log showed the fallback's attempts with no hint that a
       * whole first engine ran and failed before them.
       */
      type: "fallback";
      from: string;
      to: string;
      reason: string;
    }
  | {
      /**
       * Observability: how many reference images this build actually ran
       * with, split new-this-turn vs inherited from the thread. Emitted once
       * after resolution (lib/cad/reference-images.ts) and persisted in the
       * progress trail, so "did the build see my images?" is answerable from
       * the job record instead of guesswork. Emitted only when count > 0.
       */
      type: "references";
      /** Total references the engines received this run. */
      count: number;
      /** How many of those were inherited from the parent chain. */
      inherited: number;
    }
  | {
      /**
       * Live cost meter: cumulative usage so far, synthesized by the events
       * route from cadJobs.usage (periodically flushed mid-run) — NEVER
       * persisted into the progress log (it would spam the append-only
       * array). The studio shows tokens-so-far off this.
       */
      type: "usage";
      usage: CadUsageSummary;
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
 * the user one multiple-choice question, and RESUME with the answer (MTR-191,
 * riding MTR-175's resumable job). Resolves to EITHER a selected option id OR a
 * free-text custom answer encoded with {@link CUSTOM_ANSWER_PREFIX} (MTR-216) —
 * the caller runs {@link resolveStoredAnswer} to tell them apart. Falls back to
 * the default option id on timeout. Absent for legacy callers and secondary
 * best-of candidates — the harness then proceeds with its own judgment instead
 * of pausing, so asking is always optional.
 */
export type CadQuestionAsker = (question: CadQuestion) => Promise<string>;

/**
 * Free-text ("answer in your own words") replies to a mid-cycle question
 * (MTR-216) are stored in `cadJobs.answers` under the same key as preset picks,
 * but sentinel-prefixed so the executor can distinguish an intentional typed
 * answer from a preset option id AND from a stale/garbage value (a preset id
 * that no longer matches after the question changed). The answer route encodes;
 * the executor + agentic loop decode via {@link resolveStoredAnswer}. Option
 * ids are always `opt-N` / `q-N`, so they can never collide with this prefix.
 */
export const CUSTOM_ANSWER_PREFIX = "custom:";

/** Encode a trimmed free-text answer for storage in `cadJobs.answers`. */
export function encodeCustomAnswer(text: string): string {
  return `${CUSTOM_ANSWER_PREFIX}${text}`;
}

/** A stored answer resolved against the options that were actually offered. */
export type ResolvedAnswer =
  | { kind: "option"; option: CadQuestionOption }
  | { kind: "text"; text: string };

/**
 * Resolve a value stored in `cadJobs.answers` against the offered options.
 * Returns the matched preset option, a decoded free-text answer, or `null` when
 * the value is neither (a stale option id from a changed question / schema
 * drift, or an empty custom answer) — callers fall back to the default.
 */
export function resolveStoredAnswer(
  value: string,
  options: CadQuestionOption[]
): ResolvedAnswer | null {
  const option = options.find((o) => o.id === value);
  if (option) return { kind: "option", option };
  if (value.startsWith(CUSTOM_ANSWER_PREFIX)) {
    const text = value.slice(CUSTOM_ANSWER_PREFIX.length).trim();
    if (text) return { kind: "text", text };
  }
  return null;
}

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
  parts?: {
    name: string;
    fileAssetId: string;
    fileSlug: string;
    /** True when this part carried an editable STEP source (MTR-196). */
    hasStep?: boolean;
  }[];
  /** Slug of the Project bundling an assembly's parts, when created. */
  projectSlug?: string | null;
  /** True when the result was voxel-remeshed (an approximation). */
  remeshed?: boolean;
  /**
   * Dual-fluid isolation verdict (MTR-179) when the run declared fluid
   * circuits — the studio badge is stable at first paint.
   */
  networksReport?: CadNetworksReport | null;
  /**
   * True when the primary asset carried an editable STEP source (MTR-196).
   * Threaded so the studio can render the "Download STEP" action at first paint
   * instead of probing after mount — no late pop-in / row reflow (MTR-215).
   */
  hasStep?: boolean;
  /** Construction features for the feature-chip strip (empty when none). */
  features?: CadFeature[];
  /**
   * Dimension-contract verdicts (MTR-197) for the studio's annotation layer
   * — threaded so the layer + verified chip render at first paint, mirroring
   * `features`. Empty when the brief carried no targets.
   */
  dimensionChecks?: DimensionCheckResult[];
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
/**
 * One persisted progress entry: a stream event stamped with `t` (epoch ms,
 * added by the executor at emit time). The stamp is what makes stage timing
 * honest across reloads — a replayed transcript arrives in one burst, so
 * arrival time carries no duration signal; `t` does.
 *
 * `seq` (MTR-175 follow-up, CAD-7/CAD-8) is a monotonic per-job counter
 * stamped by `appendJobProgress` at write time. It survives the
 * MAX_PROGRESS_EVENTS drop-the-middle cap (each surviving entry keeps its
 * original seq, so the events route's cursor never desyncs from a pinned
 * array length) and doubles as the resumable-replay cursor for reconnects
 * (`?from=<seq>`). Entries written before this field existed lack it —
 * consumers must treat a missing `seq` as equal to the entry's array index.
 */
export type CadJobProgressEntry = CadStreamEvent & { t?: number; seq?: number };

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

// --- Thread history (conversation graph) ---------------------------------
//
// A revision prompt used to see only its immediate parent's code + feedback;
// the earlier turns of the thread were invisible, so multi-turn flows felt
// like the model forgot how the build had unfolded. These entries carry the
// ancestor chain (oldest first) into the revise prompts.

/** One earlier turn of a build thread, oldest-first in a history list. */
export interface ThreadHistoryEntry {
  /** That turn's instruction (truncated for prompt budget). */
  prompt: string;
  /** Owner rating on that turn's result ("good"/"bad"), when given. */
  rating?: string | null;
  /** Owner's freeform feedback note on that turn's result, when given. */
  note?: string | null;
}

/**
 * Render the thread history as a prompt block. Pure and shared (scripted +
 * agentic harness) so the framing can't drift between engines. Returns ""
 * for an empty history.
 */
export function formatThreadHistory(history: ThreadHistoryEntry[]): string {
  if (history.length === 0) return "";
  const lines = history.map((h, i) => {
    let line = `${i + 1}. "${h.prompt}"`;
    if (h.rating === "bad") line += " (user rated the result bad)";
    else if (h.rating === "good") line += " (user rated the result good)";
    if (h.note?.trim()) line += ` — user note: "${h.note.trim()}"`;
    return line;
  });
  return [
    "How this build has unfolded — the earlier instructions in this thread, oldest first:",
    ...lines,
    "The instruction you were given is the NEWEST turn. Honor the whole trajectory: keep the changes earlier turns asked for unless the newest instruction explicitly reverses them.",
  ].join("\n");
}

// --- Prompt images ---------------------------------------------------------

/** A reference image (base64, no data: prefix) passed alongside a prompt. */
export interface PromptImage {
  data: string;
  mediaType: "image/png" | "image/jpeg" | "image/gif" | "image/webp";
  /**
   * Caption sent as a text block immediately BEFORE the image. Without one an
   * image rides the turn unexplained, and once a turn carries more than one
   * (user refs + concept render + prior-attempt render) the model can only
   * guess which is which — every attached image must say what it is.
   */
  label?: string;
}

/**
 * Attach the standard user-reference caption to each image that doesn't
 * already carry a label. Shared by every step that forwards the user's
 * attached references (brief, plan, generate, routing, judge) so the framing
 * can't drift between call sites.
 */
export function labelUserReferences(
  images: PromptImage[] | null | undefined
): PromptImage[] {
  const list = images ?? [];
  return list.map((img, i) => ({
    ...img,
    label:
      img.label ??
      `User reference image ${i + 1} of ${list.length} — attached by the user as the design reference. Match its form language, proportions, and visible features unless the text instructions say otherwise.`,
  }));
}
