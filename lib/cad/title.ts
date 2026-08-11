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
- The request may mention attached images, links, or files you cannot see — ignore that entirely and just name the object.
- No quotes, no trailing punctuation, no preamble — output ONLY the title.`;

const MAX_TITLE_LEN = 60;

/**
 * Reject model output that is conversation, not a title. Seen in the wild: a
 * prompt mentioning attached images made the title model reply "I don't see
 * any attached images in your message. Could you p…" — which became the
 * permanent thread name (and read like the BUILD had lost the images). A
 * rejected title returns null; the sidebar falls back to the raw prompt.
 */
function looksLikeTitle(title: string): boolean {
  if (title.length === 0 || title.length > MAX_TITLE_LEN) return false;
  if (title.split(/\s+/).length > 8) return false;
  if (title.includes("?")) return false;
  return !/\b(I|I'm|I've|me|my|you|your|sorry|unable|cannot|can't|don't|please)\b/i.test(
    title
  );
}

export async function generateThreadTitle(
  prompt: string
): Promise<string | null> {
  if (!hasModelCredentials()) return null;
  try {
    const text = await completeText({
      system: TITLE_SYSTEM,
      prompt: `Design request: ${prompt}`,
      model: TITLE_MODEL,
      role: "title",
    });
    // Defend against a chatty model: first line, stripped of wrapping quotes,
    // and rejected outright (BEFORE truncation — a 60-char slice of a
    // conversational reply still reads as one) when it isn't title-shaped.
    const title = text
      .trim()
      .split("\n")[0]
      .replace(/^["'`]+|["'`]+$/g, "")
      .trim();
    return looksLikeTitle(title) ? title : null;
  } catch {
    return null;
  }
}
