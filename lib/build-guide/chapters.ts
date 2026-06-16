/**
 * Split a stored build-guide document into an intro + chapters keyed on
 * its H2 headings, so the reader can render long guides as collapsible,
 * navigable chapters with a table of contents.
 *
 * Operates on the raw stored string:
 *  - New guides are HTML (Tiptap output), where chapter boundaries are
 *    `<h2>…</h2>` elements.
 *  - Legacy guides are still markdown (`## …`); those contain no `<h2>`
 *    tags, so the whole document falls through as a single intro block
 *    and renders ungrouped — graceful degradation until the owner
 *    re-saves through the editor (which emits HTML).
 */

export type GuideChapter = {
  /** Stable-ish anchor id derived from the title + ordinal. */
  id: string;
  /** Plain-text heading, used as the disclosure label + TOC entry. */
  title: string;
  /** HTML between this heading and the next (or end of document). */
  bodyHtml: string;
};

export type GuideStructure = {
  /** Content before the first H2 (or the whole doc when there are none). */
  intro: string;
  chapters: GuideChapter[];
};

const H2_RE = /<h2\b[^>]*>([\s\S]*?)<\/h2>/gi;

function stripTags(s: string): string {
  return s
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .trim();
}

function slugify(title: string, ordinal: number): string {
  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base ? `ch-${ordinal}-${base}` : `ch-${ordinal}`;
}

export function splitGuideIntoChapters(html: string): GuideStructure {
  if (!html) return { intro: "", chapters: [] };

  const matches = [...html.matchAll(H2_RE)];
  if (matches.length === 0) return { intro: html, chapters: [] };

  const firstIndex = matches[0].index ?? 0;
  const intro = html.slice(0, firstIndex).trim();

  const chapters: GuideChapter[] = matches.map((m, i) => {
    const headingEnd = (m.index ?? 0) + m[0].length;
    const nextStart =
      i + 1 < matches.length ? (matches[i + 1].index ?? html.length) : html.length;
    const title = stripTags(m[1]) || `Section ${i + 1}`;
    return {
      id: slugify(title, i),
      title,
      bodyHtml: html.slice(headingEnd, nextStart).trim(),
    };
  });

  return { intro, chapters };
}
