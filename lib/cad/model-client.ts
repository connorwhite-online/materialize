import "server-only";

import Anthropic from "@anthropic-ai/sdk";

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
 */

// Default when a role doesn't pin a model (modelForRole -> CAD_MODEL_* ->
// undefined). Sonnet 4.6 is the strong, fast default proven for CAD codegen;
// override per role via the CAD_MODEL_* env vars.
const DEFAULT_MODEL = "claude-sonnet-4-6";
// build123d for a non-trivial part can run long; headroom avoids truncation.
const MAX_TOKENS = 8192;

/** True when a usable credential is present in the environment. */
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

export interface CompleteTextOptions {
  system: string;
  prompt: string;
  /** Model id; falls back to DEFAULT_MODEL when omitted. */
  model?: string;
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

  const message = await getClient().messages.create(
    {
      model: opts.model || DEFAULT_MODEL,
      max_tokens: MAX_TOKENS,
      system: opts.system,
      messages: [{ role: "user", content: opts.prompt }],
    },
    { signal: opts.signal }
  );

  return message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
}
