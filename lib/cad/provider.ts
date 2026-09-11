/**
 * Which model vendor a CAD role runs on.
 *
 * The harness was single-vendor for its first year: every role resolved to a
 * Claude id and `model-client`/`agentic` talked to the Anthropic Messages API
 * directly. This module is the seam that makes the vendor a resolved value
 * rather than an assumption, so `CAD_MODEL_*` can name `gpt-6-astra` and the
 * call path follows.
 *
 * Pure env/string reads, no `server-only`, so tests and the eval runner can
 * import it alongside ./models.
 */

export type CadProvider = "anthropic" | "openai";

/**
 * OpenAI model-id shapes. Deliberately a prefix match on the FAMILY, not a
 * list of ids: a new snapshot (`gpt-6-astra-2026-09-03`) must resolve to the
 * same provider as its base id, and an id this doesn't recognize falls to
 * Anthropic, which is where every id resolved before this existed.
 */
const OPENAI_MODEL = /^(gpt-|o[1-9](-|$)|chatgpt-|codex-)/;

/** The vendor that serves a model id. */
export function providerForModel(model: string): CadProvider {
  return OPENAI_MODEL.test(model) ? "openai" : "anthropic";
}

/**
 * The OpenAI key. `OAI_SECRET_KEY` is the name this project's deployment
 * uses; `OPENAI_API_KEY` is the SDK's own default and is accepted so a local
 * shell that already exports it works without a second variable.
 */
export function openaiApiKey(): string | undefined {
  return process.env.OAI_SECRET_KEY || process.env.OPENAI_API_KEY;
}

/** The Anthropic credential — API key, or the OAuth bearer fallback. */
export function anthropicCredential(): string | undefined {
  return process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_CODE_OAUTH_TOKEN;
}

/** True when THIS provider has a usable credential in the environment. */
export function hasCredentialsFor(provider: CadProvider): boolean {
  return provider === "openai" ? !!openaiApiKey() : !!anthropicCredential();
}

/**
 * The provider whose defaults apply when a role names no model of its own.
 *
 * `CAD_PROVIDER` forces it. Otherwise the environment decides, and OpenAI
 * wins a tie: an OpenAI key in a deployment is an explicit act (nothing
 * reads it by accident), whereas `ANTHROPIC_API_KEY` is also what the rest
 * of the tree uses. Set `CAD_PROVIDER=anthropic` to pin the old defaults
 * back with both keys present.
 */
export function defaultProvider(): CadProvider {
  const forced = process.env.CAD_PROVIDER?.toLowerCase();
  if (forced === "openai" || forced === "anthropic") return forced;
  if (openaiApiKey()) return "openai";
  return "anthropic";
}
