import "server-only";

import OpenAI from "openai";

import { openaiApiKey } from "./provider";
import type { PromptImage } from "./types";
import { openaiParamsForRole, type CadRole } from "./models";
import type { CadEffort } from "./budget";
import { CadOutputTruncatedError } from "./types";

/**
 * OpenAI call path for the CAD harness — the twin of model-client's Anthropic
 * path, and the tool-loop transport agentic.ts uses when `implement` resolves
 * to an OpenAI id.
 *
 * Everything goes through the RESPONSES API, not Chat Completions. Two
 * reasons, both load-bearing for this harness:
 *   - Tool calling on the current reasoning models is Responses-only.
 *   - A reasoning model's chain has to survive a tool round-trip. Responses
 *     keeps it server-side and `previous_response_id` re-attaches it, which
 *     is what makes the agentic loop's 16 turns one continuous build instead
 *     of 16 cold starts. The Anthropic path achieves the same thing by
 *     replaying thinking blocks in `messages`; this is the same invariant,
 *     enforced at the other end.
 *
 * Normalized usage numbers come back in Anthropic's vocabulary (input /
 * output / cacheRead / cacheWrite) so the metering and transcript sites stay
 * single-shaped — the harness reports cost per role, not per vendor.
 */

/**
 * Cap for one-shot completions.
 *
 * Reasoning tokens bill against `max_output_tokens` — they are not a separate
 * budget. At `xhigh` a frontier model can spend tens of thousands of tokens
 * thinking before it writes the first line of build123d, so a cap sized for
 * the SCRIPT alone gets consumed by the reasoning and the response comes back
 * `incomplete` with EMPTY output. This is sized for reasoning + script, and
 * `assertComplete` below makes exhaustion loud rather than silent if it is
 * still not enough.
 */
const MAX_OUTPUT_TOKENS = 32_000;

/** True when an OpenAI credential is present. */
export function hasOpenAiCredentials(): boolean {
  return !!openaiApiKey();
}

let _client: OpenAI | null = null;

/**
 * The platform OpenAI client.
 *
 * Deliberately NOT wired to the BYOK seam (lib/cad/credentials.ts): that
 * resolver returns an ANTHROPIC key by contract — its own docblock says
 * "Anthropic API key (the intended BYOK shape)" — and handing a user's
 * Anthropic key to OpenAI would leak it to a third party. Per-vendor user
 * keys belong to the real BYOK issue (MTR-181/187), where key material gets
 * a provider tag and encrypted storage; until then the OpenAI path is
 * platform-credentials only.
 */
export function openaiClient(): OpenAI {
  if (!_client) _client = new OpenAI({ apiKey: openaiApiKey() });
  return _client;
}

/** Usage normalized to the harness's (Anthropic-shaped) metering vocabulary. */
export interface NormalizedUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export function normalizeUsage(
  usage: OpenAI.Responses.ResponseUsage | undefined
): NormalizedUsage {
  return {
    inputTokens: usage?.input_tokens ?? 0,
    outputTokens: usage?.output_tokens ?? 0,
    cacheReadTokens: usage?.input_tokens_details?.cached_tokens ?? 0,
    cacheWriteTokens: usage?.input_tokens_details?.cache_write_tokens ?? 0,
  };
}

type InputContent = OpenAI.Responses.ResponseInputContent;

/**
 * Build the user turn's content parts. Same caption-then-payload ordering as
 * the Anthropic path (model-client / agentic): a labeled reference is
 * announced by its own text part so a multi-image turn stays unambiguous.
 */
export function userContentParts(opts: {
  prompt: string;
  images?: PromptImage[];
  documents?: { data: string }[];
}): InputContent[] {
  const parts: InputContent[] = [{ type: "input_text", text: opts.prompt }];
  for (const img of opts.images ?? []) {
    if (img.label) parts.push({ type: "input_text", text: img.label });
    parts.push({
      type: "input_image",
      detail: "auto",
      image_url: `data:${img.mediaType};base64,${img.data}`,
    });
  }
  for (const [i, doc] of (opts.documents ?? []).entries()) {
    // Responses takes an inline PDF as a data: URL in `file_data`; the
    // filename is required for the API to sniff the type.
    parts.push({
      type: "input_file",
      filename: `document-${i + 1}.pdf`,
      file_data: `data:application/pdf;base64,${doc.data}`,
    });
  }
  return parts;
}

/**
 * Prompt-cache routing key. OpenAI caches on the request prefix automatically;
 * this key only asks the router to send requests that share a prefix to the
 * same cache. The harness's prefix is stable PER ROLE (system prompt +
 * knowledge + exemplars), which is exactly MTR-221's byte-stable-prefix
 * design expressed in the other vendor's mechanism.
 */
function cacheKeyFor(role: CadRole): string {
  return `cad-${role}`;
}

/**
 * Concatenate the assistant text out of a response's output items.
 *
 * Deliberately NOT `response.output_text`: that field is SDK sugar applied by
 * `responses.create()`'s unwrap, and the STREAMING path never applies it — so
 * reading it after `finalResponse()` yields undefined and would silently turn
 * every streamed completion into an empty string.
 */
function outputTextOf(response: OpenAI.Responses.Response): string {
  const texts: string[] = [];
  for (const item of response.output ?? []) {
    if (item.type !== "message") continue;
    for (const part of item.content ?? []) {
      if (part.type === "output_text") texts.push(part.text);
    }
  }
  return texts.join("");
}

/** The model's refusal text, if it refused rather than answering. */
function refusalOf(response: OpenAI.Responses.Response): string | null {
  for (const item of response.output ?? []) {
    if (item.type !== "message") continue;
    for (const part of item.content ?? []) {
      if (part.type === "refusal") return part.refusal;
    }
  }
  return null;
}

/**
 * Fail loudly on a response that did not finish.
 *
 * An `incomplete` response — almost always reasoning exhausting
 * `max_output_tokens` — carries EMPTY output. Returning that as a normal empty
 * completion is how a token-budget problem reaches the harness disguised as a
 * model that had nothing to say, and then surfaces three layers downstream as
 * "no code produced". The budget is the thing that needs to be in the error.
 */
function assertComplete(
  response: OpenAI.Responses.Response,
  role: CadRole
): void {
  const refusal = refusalOf(response);
  if (refusal) {
    throw new Error(`OpenAI refused the ${role} request: ${refusal}`);
  }
  if (
    response.status === "incomplete" &&
    response.incomplete_details?.reason === "max_output_tokens"
  ) {
    // Same failure as the Anthropic transport's max_tokens stop, and the
    // harness recovers from both the same way (shorter program, lower effort).
    // Actual usage, not a constant: the tool loop runs on a different cap.
    throw new CadOutputTruncatedError(
      role,
      response.usage?.output_tokens ?? MAX_OUTPUT_TOKENS
    );
  }
  if (response.status && response.status !== "completed") {
    const reason =
      response.incomplete_details?.reason ??
      response.error?.message ??
      "unknown";
    throw new Error(
      `OpenAI ${role} response ended ${response.status} (${reason}); ` +
        `reasoning tokens count against max_output_tokens — raise the cap or ` +
        `lower CAD_EFFORT_${role.toUpperCase()}`
    );
  }
}

export interface OpenAiCompletion {
  text: string;
  model: string;
  usage: NormalizedUsage;
}

/** One-shot completion: system + a single user turn, no tools. */
export async function completeTextOpenAI(opts: {
  system: string;
  prompt: string;
  role: CadRole;
  model?: string;
  images?: PromptImage[];
  documents?: { data: string }[];
  signal?: AbortSignal;
  /** See CompleteTextOptions.effortCap. */
  effortCap?: CadEffort;
}): Promise<OpenAiCompletion> {
  const params = openaiParamsForRole(opts.role, opts.effortCap);
  // Streamed, then collected — the same reason the Anthropic agentic path
  // streams: a high-effort reasoning turn can think for minutes before
  // emitting its first visible token, which is exactly the shape that trips a
  // non-streaming request timeout. `finalResponse()` returns the same Response
  // the non-streaming call would.
  const stream = openaiClient().responses.stream(
    {
      ...params,
      ...(opts.model ? { model: opts.model } : {}),
      instructions: opts.system,
      input: [{ role: "user", content: userContentParts(opts) }],
      max_output_tokens: MAX_OUTPUT_TOKENS,
      prompt_cache_key: cacheKeyFor(opts.role),
      // Nothing chains off a one-shot, so there is no reason to leave the
      // prompt or the part's design sitting in OpenAI's storage.
      store: false,
    },
    { signal: opts.signal }
  );
  const response = await stream.finalResponse();
  assertComplete(response, opts.role);
  return {
    text: outputTextOf(response),
    model: response.model || params.model,
    usage: normalizeUsage(response.usage),
  };
}

/**
 * Cap for an agentic turn — the twin of agentic.ts's own MAX_TOKENS, with the
 * same reasoning-bills-against-output headroom as the one-shot cap above.
 */
const MAX_TOOL_OUTPUT_TOKENS = 64_000;

/** A tool the model may call, in the harness's vendor-neutral shape. */
export interface OpenAiToolDef {
  name: string;
  description?: string;
  parameters: Record<string, unknown>;
}

/** One tool call the model asked for. */
export interface OpenAiToolCall {
  /** `call_id` — the handle a `function_call_output` must quote back. */
  id: string;
  name: string;
  /** Parsed `arguments`; `{}` when the model emitted unparseable JSON. */
  input: unknown;
}

export interface OpenAiToolTurn {
  text: string;
  toolCalls: OpenAiToolCall[];
  model: string;
  usage: NormalizedUsage;
  /** Handle that re-attaches this turn's reasoning to the next request. */
  responseId: string;
}

/**
 * Conversation handle for a tool loop. Holds only the server-side pointer:
 * the harness keeps its own readable transcript, this keeps the thing the
 * API needs to continue the same reasoning chain.
 */
export interface OpenAiToolSession {
  previousResponseId?: string;
}

/**
 * One turn of a tool loop.
 *
 * `input` carries ONLY what is new since the last turn — the task on turn 1,
 * the tool outputs after that. Everything earlier is re-attached by
 * `previous_response_id`, which is also what carries the model's reasoning
 * across the tool round-trip; rebuilding the whole history each turn would
 * drop it and restart the build's train of thought every time a tool runs.
 *
 * That chaining requires `store: true` — the conversation lives on OpenAI's
 * side for the length of the build (one-shot completions above stay
 * `store: false`, since nothing chains off them). Set `CAD_OPENAI_STORE=false`
 * to refuse that, which costs the reasoning chain: each turn then starts cold
 * from the tool output alone.
 */
export async function completeWithToolsOpenAI(opts: {
  system: string;
  input: OpenAI.Responses.ResponseInputItem[];
  tools: OpenAiToolDef[];
  session: OpenAiToolSession;
  role: CadRole;
  model?: string;
  signal?: AbortSignal;
}): Promise<OpenAiToolTurn> {
  const params = openaiParamsForRole(opts.role);
  const store = process.env.CAD_OPENAI_STORE !== "false";
  const stream = openaiClient().responses.stream(
    {
      ...params,
      ...(opts.model ? { model: opts.model } : {}),
      instructions: opts.system,
      input: opts.input,
      tools: opts.tools.map((tool) => ({
        type: "function" as const,
        name: tool.name,
        description: tool.description ?? null,
        parameters: tool.parameters,
        // Non-strict: the harness's tool schemas allow optional fields, and
        // strict mode requires every property to be required + no additional
        // properties. A rejected schema would fail the whole build.
        strict: false,
      })),
      max_output_tokens: MAX_TOOL_OUTPUT_TOKENS,
      prompt_cache_key: cacheKeyFor(opts.role),
      store,
      ...(store && opts.session.previousResponseId
        ? { previous_response_id: opts.session.previousResponseId }
        : {}),
    },
    { signal: opts.signal }
  );
  const response = await stream.finalResponse();
  assertComplete(response, opts.role);

  if (store) opts.session.previousResponseId = response.id;

  const toolCalls: OpenAiToolCall[] = [];
  for (const item of response.output ?? []) {
    if (item.type !== "function_call") continue;
    let input: unknown = {};
    try {
      input = item.arguments ? JSON.parse(item.arguments) : {};
    } catch {
      // A malformed argument blob is the model's mistake to repair, not a
      // transport failure — hand the tool an empty input and let the tool's
      // own validation report back.
      input = {};
    }
    toolCalls.push({ id: item.call_id, name: item.name, input });
  }

  return {
    text: outputTextOf(response),
    toolCalls,
    model: response.model || params.model,
    usage: normalizeUsage(response.usage),
    responseId: response.id,
  };
}
