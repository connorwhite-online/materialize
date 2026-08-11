import type Anthropic from "@anthropic-ai/sdk";

/**
 * Flight recorder v2: the full per-attempt transcript of one generation job —
 * every model call (system + prompt + response), every sidecar execution
 * (code + validation + render), and the agentic session's message log —
 * persisted as one gzipped JSON in R2 (`cad-transcripts/`, key stamped on
 * cadJobs.transcriptStorageKey by executeCadJob).
 *
 * Why: cadJobs.progress records THAT attempts happened and why they repaired;
 * it never records what the model saw or said. Questions like "why does it
 * keep making sharp edges" or "did the judge actually penalize the drift"
 * were unanswerable from data. This makes the whole run replayable.
 *
 * Propagation mirrors CadMeter (lib/cad/metering.ts): the recorder rides the
 * AsyncLocalStorage generation context, instrumented call sites record into
 * whatever recorder is active, and with no active recorder every call is a
 * no-op — evals, scripts, and tests are unaffected. No `server-only`: pure
 * bookkeeping, importable from tests; the R2 upload lives with the caller.
 *
 * Size discipline: system prompts are byte-stable per job and huge — deduped
 * into a `systems` table referenced by index. Base64 image PAYLOADS are never
 * recorded (labels/counts only), except one render per exec (the thing being
 * judged). The serialized JSON is gzipped at rest.
 */

/** One recorded model completion (completeText — plan/brief/generate/judge/…). */
export interface TranscriptModelEvent {
  kind: "model";
  /** ms since the recorder was created. */
  t: number;
  role: string;
  model: string;
  /** Index into CadTranscript.systems. */
  systemRef: number;
  prompt: string;
  /** Captions of images sent with the turn (payloads never recorded). */
  imageLabels: string[];
  response: string;
  ms: number;
  inputTokens?: number;
  outputTokens?: number;
}

/** One recorded sidecar execution (scripted /run or agentic session exec). */
export interface TranscriptExecEvent {
  kind: "exec";
  t: number;
  source: "runner" | "session";
  code: string;
  ok: boolean;
  error?: string | null;
  /** Raw validation verdict from the sidecar, when one came back. */
  validation?: unknown;
  /** Base64 PNG render of the produced solid, when one came back. */
  render?: string | null;
}

/** The agentic loop's full message log (image payloads stripped). */
export interface TranscriptAgenticEvent {
  kind: "agentic";
  t: number;
  messages: unknown;
}

export type CadTranscriptEvent =
  | TranscriptModelEvent
  | TranscriptExecEvent
  | TranscriptAgenticEvent;

export interface CadTranscript {
  v: 1;
  jobId: string;
  generationId: string;
  prompt: string;
  /** Deduped system prompts; model events reference by index. */
  systems: string[];
  events: CadTranscriptEvent[];
  /** True when the event cap truncated the tail (runaway-loop backstop). */
  truncated: boolean;
  /** Recorder wall time, ms (creation → serialize). */
  totalMs: number;
}

// Backstop far above any real run (scripted ≤4 attempts; agentic tool turns
// are budgeted) — a runaway loop must not accrete an unbounded transcript.
const MAX_EVENTS = 500;

export function transcriptsEnabled(): boolean {
  return process.env.CAD_TRANSCRIPT !== "false";
}

/**
 * Replace base64 image payloads with a placeholder throughout an agentic
 * message log, keeping the structure (roles, text, tool calls/results)
 * intact. Exported for tests.
 */
export function stripImagePayloads(messages: unknown): unknown {
  const strip = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(strip);
    if (node && typeof node === "object") {
      const obj = node as Record<string, unknown>;
      if (
        obj.type === "image" &&
        obj.source &&
        typeof obj.source === "object"
      ) {
        return { type: "image", source: "[image payload omitted]" };
      }
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(obj)) out[k] = strip(v);
      return out;
    }
    return node;
  };
  return strip(messages);
}

export class CadTranscriptRecorder {
  private readonly startedAt = Date.now();
  private readonly systems: string[] = [];
  private readonly systemIndex = new Map<string, number>();
  private readonly events: CadTranscriptEvent[] = [];
  private truncated = false;

  constructor(
    private readonly ids: { jobId: string; generationId: string; prompt: string }
  ) {}

  private push(event: CadTranscriptEvent): void {
    if (this.events.length >= MAX_EVENTS) {
      this.truncated = true;
      return;
    }
    this.events.push(event);
  }

  private systemRef(system: string): number {
    const existing = this.systemIndex.get(system);
    if (existing !== undefined) return existing;
    const idx = this.systems.push(system) - 1;
    this.systemIndex.set(system, idx);
    return idx;
  }

  recordModelCall(e: {
    role: string;
    model: string;
    system: string;
    prompt: string;
    imageLabels: string[];
    response: string;
    ms: number;
    inputTokens?: number;
    outputTokens?: number;
  }): void {
    this.push({
      kind: "model",
      t: Date.now() - this.startedAt,
      role: e.role,
      model: e.model,
      systemRef: this.systemRef(e.system),
      prompt: e.prompt,
      imageLabels: e.imageLabels,
      response: e.response,
      ms: e.ms,
      inputTokens: e.inputTokens,
      outputTokens: e.outputTokens,
    });
  }

  recordExec(e: {
    source: "runner" | "session";
    code: string;
    ok: boolean;
    error?: string | null;
    validation?: unknown;
    render?: string | null;
  }): void {
    this.push({
      kind: "exec",
      t: Date.now() - this.startedAt,
      source: e.source,
      code: e.code,
      ok: e.ok,
      error: e.error ?? null,
      validation: e.validation,
      render: e.render ?? null,
    });
  }

  /** The agentic loop's message log; call once, at loop end (any exit). */
  recordAgenticMessages(messages: Anthropic.MessageParam[] | unknown): void {
    this.push({
      kind: "agentic",
      t: Date.now() - this.startedAt,
      messages: stripImagePayloads(messages),
    });
  }

  /** True when anything was recorded — an empty transcript isn't uploaded. */
  hasEvents(): boolean {
    return this.events.length > 0;
  }

  serialize(): CadTranscript {
    return {
      v: 1,
      jobId: this.ids.jobId,
      generationId: this.ids.generationId,
      prompt: this.ids.prompt,
      systems: this.systems,
      events: this.events,
      truncated: this.truncated,
      totalMs: Date.now() - this.startedAt,
    };
  }
}
