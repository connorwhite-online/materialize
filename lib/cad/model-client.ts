import "server-only";

/**
 * Thin, defensive wrapper over the Claude Agent SDK's `query` for one-shot
 * text completions (the harness drives its own repair loop, so each call
 * is a single completion with no tools).
 *
 * Auth resolution mirrors lib/email/client.ts's "stub when unconfigured"
 * philosophy, but the actual stubbing lives in the harness (it needs a
 * CAD-shaped fallback). Here we just report whether credentials exist and,
 * if so, run the model. The SDK reads credentials from the environment:
 *
 *   - CLAUDE_CODE_OAUTH_TOKEN — the owner's Claude Code subscription token
 *     (convenient for the private experiment).
 *   - ANTHROPIC_API_KEY — the production-clean path; swap to this before
 *     any public/multi-user exposure (ToS + independent billing).
 *
 * Dynamic import keeps the heavy native SDK out of the module graph until a
 * generation actually runs, so importing the harness (from a page/action)
 * stays cheap.
 */

/** True when either supported credential is present in the environment. */
export function hasModelCredentials(): boolean {
  return !!(
    process.env.CLAUDE_CODE_OAUTH_TOKEN || process.env.ANTHROPIC_API_KEY
  );
}

export interface CompleteTextOptions {
  system: string;
  prompt: string;
  /** Model id; defaults to the SDK's default when omitted. */
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
      "No model credentials (set CLAUDE_CODE_OAUTH_TOKEN or ANTHROPIC_API_KEY)"
    );
  }

  const { query } = await import("@anthropic-ai/claude-agent-sdk");

  const abort = new AbortController();
  if (opts.signal) {
    if (opts.signal.aborted) abort.abort();
    else opts.signal.addEventListener("abort", () => abort.abort());
  }

  const result = query({
    prompt: opts.prompt,
    options: {
      abortController: abort,
      systemPrompt: opts.system,
      // No tools — this is a plain completion; the harness owns the loop.
      allowedTools: [],
      maxTurns: 1,
      ...(opts.model ? { model: opts.model } : {}),
    },
  });

  let text = "";
  for await (const message of result) {
    if (message.type === "assistant") {
      const content = message.message.content;
      if (Array.isArray(content)) {
        for (const block of content) {
          const b = block as { type?: string; text?: string };
          if (b.type === "text" && typeof b.text === "string") text += b.text;
        }
      }
    }
  }
  return text;
}
