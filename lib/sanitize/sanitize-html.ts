import "server-only";

import { unified } from "unified";
import rehypeParse from "rehype-parse";
import rehypeSanitize from "rehype-sanitize";
import rehypeStringify from "rehype-stringify";

import { richHtmlSchema } from "./html-schema";

// Parse an HTML *fragment* (the editor emits body-level markup, not a
// full document), scrub it against the shared allowlist, and serialize
// it back to a string. Built once at module load and reused per call.
const processor = unified()
  .use(rehypeParse, { fragment: true })
  .use(rehypeSanitize, richHtmlSchema)
  .use(rehypeStringify);

/**
 * Sanitize owner-authored rich HTML before it is persisted.
 *
 * The build guide is rendered with `<MarkdownProse allowHtml>`, which
 * already sanitizes at render time — but sanitizing on write too means
 * the value sitting in the column is clean for *any* consumer (emails,
 * llms.txt, MCP responses), not just the one render path. The allowlist
 * is shared with the renderer (richHtmlSchema) so the two never drift.
 */
export async function sanitizeRichHtml(html: string): Promise<string> {
  const file = await processor.process(html);
  return String(file);
}
