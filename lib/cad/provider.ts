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
 * The OpenAI key as configured. `OAI_SECRET_KEY` is the name this project's
 * deployment uses; `OPENAI_API_KEY` is the SDK's own default and is accepted
 * so a local shell that already exports it works without a second variable.
 */
export function openaiApiKey(): string | undefined {
  const raw = (
    process.env.OAI_SECRET_KEY ||
    process.env.OPENAI_API_KEY ||
    ""
  ).trim();
  return raw || undefined;
}

/**
 * Shape of a real OpenAI secret. Every issued key is `sk-` followed by a long
 * opaque body (`sk-proj-…`, `sk-svcacct-…` and friends all share the prefix).
 */
const OPENAI_KEY_SHAPE = /^sk-\S{16,}$/;

let warnedAboutKeyShape = false;

/**
 * The key, but only if it could possibly authenticate.
 *
 * This guard exists because of a real outage: provider selection keys off
 * whether an OpenAI credential is PRESENT, so a variable holding something
 * that is not a key — the six-character identifier the dashboard prints
 * beside a secret, a pasted one-time code, a truncated copy — still captured
 * every role and turned one mistyped env var into a total generation outage,
 * 401ing on every call with no path back to the working vendor.
 *
 * A value that cannot be a key is therefore treated as no key at all: the
 * harness stays on Anthropic and says why, which degrades instead of failing.
 * An explicit `CAD_PROVIDER=openai` still forces the issue — stated intent
 * beats a shape heuristic, and the 401 is then the answer the operator asked
 * for.
 */
export function usableOpenaiKey(): string | undefined {
  const key = openaiApiKey();
  if (!key) return undefined;
  if (OPENAI_KEY_SHAPE.test(key)) return key;
  if (!warnedAboutKeyShape) {
    warnedAboutKeyShape = true;
    console.warn(
      "[cad/provider] OAI_SECRET_KEY/OPENAI_API_KEY is set but is not shaped " +
        "like an OpenAI secret (expected `sk-…`); ignoring it for provider " +
        "selection and staying on Anthropic. Set CAD_PROVIDER=openai to use " +
        "it anyway."
    );
  }
  return undefined;
}

/** The Anthropic credential — API key, or the OAuth bearer fallback. */
export function anthropicCredential(): string | undefined {
  return process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_CODE_OAUTH_TOKEN;
}

/** True when THIS provider has a usable credential in the environment. */
export function hasCredentialsFor(provider: CadProvider): boolean {
  return provider === "openai"
    ? !!usableOpenaiKey()
    : !!anthropicCredential();
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
  if (usableOpenaiKey()) return "openai";
  return "anthropic";
}
