import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CAD_OP_ICONS } from "@/components/icons/cad";
import { iconKindForOp } from "@/components/cad/feature-timeline";

/**
 * The chips are icon-only, so a kind with no glyph renders an EMPTY square —
 * no text fallback, no error, just a blank chip. These pin the set total and
 * the traits that let nine glyphs read as one family at 16px.
 */

const KINDS = [
  "extrude",
  "revolve",
  "boolean",
  "fillet",
  "chamfer",
  "shell",
  "loft",
  "hole",
  "generic",
] as const;

describe("CAD_OP_ICONS", () => {
  it("covers every timeline icon kind", () => {
    for (const kind of KINDS) {
      expect(CAD_OP_ICONS[kind], `no glyph for "${kind}"`).toBeTypeOf(
        "function"
      );
    }
    expect(Object.keys(CAD_OP_ICONS).sort()).toEqual([...KINDS].sort());
  });

  it("covers whatever iconKindForOp can return for an unknown op", () => {
    // A future sidecar op must still land on a rendered glyph, not a blank.
    expect(CAD_OP_ICONS[iconKindForOp("some-future-op")]).toBe(
      CAD_OP_ICONS.generic
    );
  });

  it.each(KINDS)("%s renders a themeable 24-unit glyph", (kind) => {
    const html = renderToStaticMarkup(CAD_OP_ICONS[kind]({}));
    // currentColor is what makes one set work in both themes and inherit the
    // chip's hover/open text colour.
    expect(html).toContain('stroke="currentColor"');
    expect(html).toContain('viewBox="0 0 24 24"');
    // Decorative: the chip button owns the accessible name (aria-label).
    expect(html).toContain('aria-hidden="true"');
    // No hardcoded fill would survive a theme flip.
    expect(html).not.toMatch(/fill="#[0-9a-f]{3,8}"/i);
  });

  it("renders at the size it is asked for", () => {
    const html = renderToStaticMarkup(CAD_OP_ICONS.fillet({ size: 32 }));
    expect(html).toContain('width="32"');
    expect(html).toContain('height="32"');
  });
});
