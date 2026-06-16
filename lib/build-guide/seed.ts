import { marked } from "marked";

/**
 * Helpers for moving a stored build guide in and out of the editor.
 *
 * Guides are stored as HTML, but legacy rows still hold markdown. These
 * functions bridge that: `toEditorHtml` seeds the editor (converting
 * legacy markdown once), and `isEmptyHtml` decides whether the editor's
 * output should collapse to NULL.
 */

// Stored guides predate the WYSIWYG editor and may hold markdown. Detect
// that so we convert markdown → HTML once, when the editor first opens a
// legacy guide. New guides are saved as HTML and already contain tags.
export function looksLikeHtml(content: string): boolean {
  return /<(p|div|h[1-6]|ul|ol|li|img|br|blockquote|pre|table|strong|em|a)\b/i.test(
    content
  );
}

export function toEditorHtml(content: string | null): string {
  if (!content) return "";
  if (looksLikeHtml(content)) return content;
  // marked passes embedded HTML through and renders markdown to HTML.
  return marked.parse(content, { async: false }) as string;
}

// Tiptap emits `<p></p>` for an empty document. Treat a guide as empty
// when it has no text and no standalone media so we store NULL rather
// than an empty paragraph.
export function isEmptyHtml(html: string): boolean {
  if (/<(img|hr)\b/i.test(html)) return false;
  return (
    html
      .replace(/<[^>]*>/g, "")
      .replace(/&nbsp;/gi, " ")
      .trim().length === 0
  );
}
