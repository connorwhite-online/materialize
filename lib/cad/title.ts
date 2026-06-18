import "server-only";

import { completeText, hasModelCredentials } from "./model-client";

/**
 * Generate a short, human-friendly title for a text-to-CAD thread — what the
 * sidebar shows instead of the raw first prompt. Best-effort: returns null
 * when no model credentials are configured or the call fails, so a missing
 * title never blocks (or fails) a generation. Called once per thread, on the
 * root generation's first success.
 */

// Cheap + fast — titling is a throwaway one-liner, not the main generation.
const TITLE_MODEL = "claude-haiku-4-5-20251001";

const TITLE_SYSTEM = `You write a concise title for a 3D-model design thread.
Rules:
- 3 to 6 words, Title Case.
- Name the object and its most distinctive trait (e.g. "iPhone Air Case, MagSafe").
- No quotes, no trailing punctuation, no preamble — output ONLY the title.`;

const MAX_TITLE_LEN = 60;

export async function generateThreadTitle(
  prompt: string
): Promise<string | null> {
  if (!hasModelCredentials()) return null;
  try {
    const text = await completeText({
      system: TITLE_SYSTEM,
      prompt: `Design request: ${prompt}`,
      model: TITLE_MODEL,
    });
    // Defend against a chatty model: first line, stripped of wrapping quotes.
    const title = text
      .trim()
      .split("\n")[0]
      .replace(/^["'`]+|["'`]+$/g, "")
      .trim()
      .slice(0, MAX_TITLE_LEN);
    return title || null;
  } catch {
    return null;
  }
}
