import "server-only";

import Anthropic from "@anthropic-ai/sdk";

import { activeCadContext, meterModelUsage } from "./metering";
import type { ResolvedModelCredentials } from "./credentials";
import type { PromptImage } from "./types";
import { cadRoleOrDefault, modelParamsForRole } from "./models";

/**
 * Thin wrapper over the Anthropic Messages API for one-shot text completions
 * (the harness drives its own plan/repair loop, so each call is a single
 * completion with no tools).
 *
 * Why the direct API, not the Agent SDK's `query()`: `query()` spawns a Claude
 * Code subprocess per call — fine locally but heavy, occasionally wedged, and
 * unproven on serverless. A plain HTTPS call is faster, reliable, and the
 * production-clean path. See CON-174.
 *
 * Credentials (in priority order):
 *   - ANTHROPIC_API_KEY — the API key; the intended path (independent billing,
 *     correct ToS for a server). Read automatically by the SDK.
 *   - CLAUDE_CODE_OAUTH_TOKEN — sent as a bearer `authToken` fallback so a
 *     subscription-only setup still resolves credentials; prefer the API key.
 * With neither, the harness uses its deterministic local stub (offline demo).
 *
 * BYOK seam (MTR-181): when the active generation context carries USER
 * credentials (lib/cad/credentials.ts — CAD_BYOK_ENABLED, off by default),
 * the call runs on a per-request client built from them instead of the
 * platform singleton. Platform credentials keep the singleton, so the
 * default path is byte-identical.
 *
 * Metering (MTR-181): every completion records its token usage (per role +
 * model) into the active CadMeter — a no-op outside a metered run.
 */

// The model + thinking/effort for a call come from modelParamsForRole (see
// ./models) — this module no longer carries a default id of its own, so there
// is one place a role's model is decided instead of two that drift.
//
// build123d for a non-trivial part can run long, and adaptive thinking spends
// from the SAME budget, so 8192 (the pre-thinking cap) now truncates long
// scripts. 16000 is the headroom that still lands inside the SDK's
// non-streaming HTTP timeout; the agentic loop streams instead and can go
// higher.
const MAX_TOKENS = 16_000;

/**
 * True when a usable credential is present in the environment.
 *
 * Deliberately env-only even under BYOK: the user-key path has no storage yet
 * (MTR-187 gate), so a user key can never be the ONLY credential. Revisit
 * when real BYOK lands.
 */
export function hasModelCredentials(): boolean {
  return !!(
    process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_CODE_OAUTH_TOKEN
  );
}

let _client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!_client) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    _client = apiKey
      ? new Anthropic({ apiKey })
      : new Anthropic({ authToken: process.env.CLAUDE_CODE_OAUTH_TOKEN });
  }
  return _client;
}

/**
 * The client for this call: a per-request instance for USER credentials
 * (BYOK — never cached, never shared across users), the platform singleton
 * otherwise. Exported for the agentic loop, which owns its own tool-use
 * calls but must follow the same credential resolution.
 */
export function clientForCredentials(
  creds: ResolvedModelCredentials | undefined
): Anthropic {
  if (creds?.source === "user" && creds.apiKey) {
    return new Anthropic({ apiKey: creds.apiKey });
  }
  return getClient();
}

// PromptImage (and the caption helper labelUserReferences) live in ./types —
// pure, client-safe, and NOT test-mocked alongside this module. Re-exported
// here because every model-call site historically imports the type from the
// client wrapper.
export type { PromptImage } from "./types";

export interface CompleteTextOptions {
  system: string;
  prompt: string;
  /** Model id; falls back to the role's configured model when omitted. */
  model?: string;
  /**
   * Harness role making the call ("plan", "brief", "critique", …). Attributes
   * token usage in the metering summary (MTR-181) AND selects the model +
   * thinking/effort params when `model` is not pinned. Callers outside the
   * role set (e.g. "route") pass a free-form label and get the plan role's
   * params, which is what they were already resolving by hand.
   */
  role?: string;
  /** Reference images to include in the user turn (multimodal). */
  images?: PromptImage[];
  /**
   * PDF documents to include in the user turn (base64, no data: prefix) —
   * the datasheet-reading path (lib/cad/repo-fetch.ts). The API reads PDFs
   * natively, including the mechanical-drawing pages vision needs.
   */
  documents?: { data: string }[];
  signal?: AbortSignal;
}

/**
 * Run a single completion and return the concatenated assistant text.
 * Throws if no credentials are configured — callers should gate on
 * `hasModelCredentials()` first and fall back as appropriate.
 */
export async function completeText(opts: CompleteTextOptions): Promise<string> {
  if (!hasModelCredentials()) {
    throw new Error(
      "No model credentials (set ANTHROPIC_API_KEY or CLAUDE_CODE_OAUTH_TOKEN)"
    );
  }

  const content: Anthropic.ContentBlockParam[] = [
    { type: "text", text: opts.prompt },
  ];
  for (const img of opts.images ?? []) {
    // Caption-then-image: a labeled image is announced by its own text block
    // so multi-image turns (refs + concept + prior render) stay unambiguous.
    if (img.label) content.push({ type: "text", text: img.label });
    content.push({
      type: "image",
      source: { type: "base64", media_type: img.mediaType, data: img.data },
    });
  }
  for (const doc of opts.documents ?? []) {
    content.push({
      type: "document",
      source: {
        type: "base64",
        media_type: "application/pdf",
        data: doc.data,
      },
    });
  }

  const client = clientForCredentials(activeCadContext()?.credentials);
  const started = Date.now();
  const params = modelParamsForRole(cadRoleOrDefault(opts.role));
  const message = await client.messages.create(
    {
      ...params,
      // An explicitly pinned model wins over the role's default, but keeps the
      // role's thinking/effort — the pin is a routing choice, not an opt-out
      // of reasoning.
      ...(opts.model ? { model: opts.model } : {}),
      max_tokens: MAX_TOKENS,
      // Prompt caching (MTR-221): the system prompt (base prompt + knowledge
      // blocks + exemplars) is byte-identical across every repair attempt of a
      // job — a breakpoint on its final block lets attempt 2+ read it from
      // cache instead of re-paying full input price.
      system: [
        {
          type: "text",
          text: opts.system,
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [{ role: "user", content }],
    },
    { signal: opts.signal }
  );
  meterModelUsage({
    role: opts.role ?? "other",
    model: message.model || opts.model || params.model,
    inputTokens: message.usage?.input_tokens ?? 0,
    outputTokens: message.usage?.output_tokens ?? 0,
    cacheReadTokens: message.usage?.cache_read_input_tokens ?? 0,
    cacheWriteTokens: message.usage?.cache_creation_input_tokens ?? 0,
    ms: Date.now() - started,
  });

  const response = message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");

  // Flight recorder (lib/cad/transcript.ts): full prompt/response for the
  // persisted job transcript. Observation-only; no-op without a recorder.
  activeCadContext()?.recorder?.recordModelCall({
    role: opts.role ?? "other",
    model: message.model || opts.model || params.model,
    system: opts.system,
    prompt: opts.prompt,
    imageLabels: (opts.images ?? []).map(
      (img, i) => img.label ?? `[unlabeled image ${i + 1}]`
    ),
    response,
    ms: Date.now() - started,
    inputTokens: message.usage?.input_tokens ?? undefined,
    outputTokens: message.usage?.output_tokens ?? undefined,
  });

  return response;
}
