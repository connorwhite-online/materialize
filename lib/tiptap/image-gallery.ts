import { Node, mergeAttributes } from "@tiptap/core";

/**
 * A gallery block that groups several images into one row. It holds
 * Image nodes as its content (`image+`), so it reuses the existing
 * `@tiptap/extension-image` node rather than a bespoke React NodeView.
 *
 * Serializes to `<div data-gallery class="build-guide-gallery">…imgs…</div>`,
 * which is allow-listed by `richHtmlSchema`. On the read page the
 * `data-gallery` marker is what `MarkdownProse` keys on to render the
 * row + click-to-expand carousel (BuildGuideGallery).
 */
export const ImageGallery = Node.create({
  name: "imageGallery",
  group: "block",
  content: "image+",
  draggable: true,
  isolating: true,

  parseHTML() {
    return [{ tag: "div[data-gallery]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-gallery": "true",
        class: "build-guide-gallery",
      }),
      0,
    ];
  },
});
