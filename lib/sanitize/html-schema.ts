import { defaultSchema, type Options as SanitizeSchema } from "rehype-sanitize";

/**
 * Shared sanitize allowlist for owner-authored rich HTML — the project
 * build guide, which is now stored as HTML produced by the WYSIWYG
 * editor (or pasted from a README) rather than markdown.
 *
 * Starts from rehype-sanitize's safe default (strips <script>, event
 * handlers, javascript: URLs, etc.) and additionally permits the
 * presentational `align` attribute and explicit <img> sizing so pasted
 * README HTML and editor output render faithfully without opening an
 * injection hole.
 *
 * Two call sites MUST stay in lockstep on this allowlist:
 *  - render time: <MarkdownProse allowHtml> (components/ui/markdown-prose.tsx)
 *  - write  time: sanitizeRichHtml() (lib/sanitize/sanitize-html.ts),
 *                 called by updateProjectBuildGuide before persisting.
 */
export const richHtmlSchema: SanitizeSchema = {
  ...defaultSchema,
  // Permit the gallery container element. Everything else stays on the
  // default (GitHub) tag allowlist.
  tagNames: [...(defaultSchema.tagNames ?? []), "div"],
  attributes: {
    ...defaultSchema.attributes,
    "*": [...(defaultSchema.attributes?.["*"] ?? []), "align"],
    img: [
      ...(defaultSchema.attributes?.img ?? []),
      "width",
      "height",
      "loading",
    ],
    // A <div> is only allowed as a gallery: the `data-gallery` marker
    // plus a className locked to the single gallery class. This keeps the
    // surface minimal — no arbitrary divs/classes survive sanitization.
    div: [["className", "build-guide-gallery"], "dataGallery"],
  },
};
