// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { AnimatedWordmark, Logomark, Wordmark } from "../logo";
import { MARK_PATH, WORDMARK_GLYPHS } from "../logo-paths";

describe("brand logo geometry", () => {
  it("splits the wordmark into one path per letter of 'materialize'", () => {
    // The animated reveal walks this array in order and treats index 0 as
    // the persistent mark. A re-export that merged or reordered the paths
    // would still render a correct-looking wordmark but would break the
    // stagger, so pin the shape here.
    expect(WORDMARK_GLYPHS.map((g) => g.letter).join("")).toBe("materialize");
    expect(WORDMARK_GLYPHS.every((g) => g.d.startsWith("M"))).toBe(true);
  });

  it("keeps app/icon.svg in sync with MARK_PATH", () => {
    // The favicon is a static asset, so it is the one place the mark's
    // geometry is duplicated. This is the guard against updating the
    // components and leaving a stale logo in the browser tab.
    const icon = readFileSync(
      path.join(process.cwd(), "app/icon.svg"),
      "utf8"
    );
    expect(icon).toContain(MARK_PATH);
  });
});

describe("Logomark", () => {
  it("paints with currentColor so it follows the theme", () => {
    const { container } = render(<Logomark />);
    expect(container.querySelector("svg")?.getAttribute("fill")).toBe(
      "currentColor"
    );
  });

  it("derives width from height, and is hidden unless given a title", () => {
    const { container, rerender } = render(<Logomark height={40} />);
    const svg = () => container.querySelector("svg")!;
    expect(Number(svg().getAttribute("width"))).toBeCloseTo(40 * (415 / 251));
    expect(svg().getAttribute("aria-hidden")).toBe("true");

    rerender(<Logomark height={40} title="Materialize" />);
    expect(svg().getAttribute("role")).toBe("img");
    expect(svg().getAttribute("aria-label")).toBe("Materialize");
    expect(svg().getAttribute("aria-hidden")).toBeNull();
  });
});

describe("Wordmark", () => {
  it("renders every glyph", () => {
    const { container } = render(<Wordmark />);
    expect(container.querySelectorAll("path")).toHaveLength(
      WORDMARK_GLYPHS.length
    );
    expect(container.querySelector("svg")?.getAttribute("fill")).toBe(
      "currentColor"
    );
  });
});

describe("AnimatedWordmark", () => {
  it("animates every letter except the mark, which stays painted", () => {
    const { container } = render(<AnimatedWordmark />);
    expect(container.querySelectorAll(".mz-logo-letter")).toHaveLength(
      WORDMARK_GLYPHS.length - 1
    );
    // The "M" renders outside the staggered group so it never blurs, clips,
    // or fades — it is the anchor both static variants share.
    expect(container.querySelector("svg > path")?.getAttribute("d")).toBe(
      WORDMARK_GLYPHS[0].d
    );
    expect(container.querySelector("svg > path")?.classList.contains("mz-logo-mark")).toBe(
      true
    );
  });

  it("paces the stagger forward for reveal and backward for collapse", () => {
    const { container } = render(<AnimatedWordmark />);
    const letters = [
      ...container.querySelectorAll<SVGGElement>(".mz-logo-letter"),
    ];
    const first = letters[0].style;
    const last = letters[letters.length - 1].style;
    expect(first.getPropertyValue("--mz-i")).toBe("0");
    expect(last.getPropertyValue("--mz-i")).toBe(String(letters.length - 1));
    // Reverse index runs the other way so collapsing peels right → left.
    expect(first.getPropertyValue("--mz-r")).toBe(String(letters.length - 1));
    expect(last.getPropertyValue("--mz-r")).toBe("0");
  });

  it("uses toggle mode when controlled and mount mode when not", () => {
    const { container, rerender } = render(<AnimatedWordmark animateOnMount />);
    const root = () => container.querySelector(".mz-logo") as HTMLElement;
    expect(root().dataset.mzMode).toBe("mount");

    // An explicit `expanded` always wins — a controlled logo must track the
    // prop rather than play a one-shot mount animation and then sit still.
    rerender(<AnimatedWordmark animateOnMount expanded={false} />);
    expect(root().dataset.mzMode).toBe("toggle");
    expect(root().dataset.mzExpanded).toBe("false");

    rerender(<AnimatedWordmark animateOnMount expanded />);
    expect(root().dataset.mzExpanded).toBe("true");
  });

  it("only writes --mz-h inline when a height is given", () => {
    // Inline styles outrank stylesheet rules, so writing --mz-h
    // unconditionally would silently defeat responsive `[--mz-h:…]` classes.
    const { container, rerender } = render(<AnimatedWordmark />);
    const root = () => container.querySelector(".mz-logo") as HTMLElement;
    expect(root().style.getPropertyValue("--mz-h")).toBe("");

    rerender(<AnimatedWordmark height={32} />);
    expect(root().style.getPropertyValue("--mz-h")).toBe("32px");
  });

  it("grows only the mark on toggle-collapse, never the wordmark SVG", () => {
    // A previous pass scaled `> svg`, which made the remaining letters
    // grow as they peeled — the opposite of the scroll effect. The
    // scale lives on `.mz-logo-mark` and only under toggle+collapsed,
    // so mount-mode first paint cannot shrink a large M into a small word.
    const css = readFileSync(
      path.join(process.cwd(), "app/globals.css"),
      "utf8"
    );
    expect(css).toMatch(/--mz-mark-scale:\s*1\.\d+/);
    expect(css).toMatch(
      /data-mz-mode="toggle"\]\[data-mz-expanded="false"\][\s\S]*?\.mz-logo-mark \{[\s\S]*?scale\(var\(--mz-mark-scale\)\)/
    );
    expect(css).not.toMatch(
      /data-mz-expanded="false"\] > svg \{[\s\S]*?scale\(var\(--mz-mark-scale\)\)/
    );
  });
});
