import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Pin the anon-home hero layout contracts. These are easy to regress
 * from a Tailwind class shuffle — iOS 26 Safari overlays chrome on
 * the layout viewport, so svh-only leaves --background bars around
 * the photo.
 */
const page = readFileSync(resolve(__dirname, "../../../app/page.tsx"), "utf8");
const layout = readFileSync(resolve(__dirname, "../../../app/layout.tsx"), "utf8");
const heroBackground = readFileSync(
  resolve(__dirname, "../hero-background.tsx"),
  "utf8"
);
const globals = readFileSync(
  resolve(__dirname, "../../../app/globals.css"),
  "utf8"
);
const classNames = [...page.matchAll(/className="([^"]*)"/g)]
  .map((match) => match[1])
  .join(" ");

describe("anon home hero layout", () => {
  it("paints the photo on the large viewport, copy on svh", () => {
    expect(classNames).toMatch(/\bh-lvh\b/);
    expect(classNames).toMatch(/min-h-\[100vh\]/);
    expect(classNames).toMatch(/\bh-svh\b/);
  });

  it("covers the iOS unsafe areas so the photo can sit under chrome", () => {
    expect(layout).toMatch(/viewportFit:\s*"cover"/);
  });

  it("places mobile copy below center, padded above the floating pill", () => {
    expect(classNames).toMatch(/\bitems-end\b/);
    expect(classNames).toMatch(/\bpb-32\b/);
    expect(classNames).not.toMatch(/\bpt-16\b/);
  });

  it("paints the subheading darker than muted-foreground", () => {
    expect(classNames).toMatch(/text-foreground\/90/);
    const sub = page.match(
      /<p className="([^"]*)">\s*Get prints delivered to your door/
    );
    expect(sub?.[1]).toBeDefined();
    expect(sub?.[1]).not.toMatch(/text-muted-foreground/);
  });
});

/**
 * iOS 26 Safari fills the status-bar band above the page with a colour
 * sampled from the page, and the sampling rules are narrow enough that
 * an innocuous-looking edit silently restores the cream strip:
 * `background-color` only (a `background-image` is never read), off
 * `<body>` (never `<html>`), at initial render (JS can't re-tint).
 * `<meta name="theme-color">` is ignored outright. None of that shows
 * up as a type error or a failing render, so it is pinned here.
 */
describe("anon home browser-chrome tint", () => {
  it("marks the hero so body:has() can scope the tint to this route", () => {
    expect(page).toMatch(/data-hero-chrome/);
    expect(globals).toMatch(
      /body:has\(\[data-hero-chrome\]\)\s*\{[^}]*background-color:\s*var\(--hero-chrome-tint\)/
    );
  });

  it("tints background-color, not a background-image", () => {
    const rule = globals.match(
      /body:has\(\[data-hero-chrome\]\)\s*\{([^}]*)\}/
    )?.[1];
    expect(rule).toBeDefined();
    // A gradient here would render identically on-page and be invisible
    // to the sampler — the exact trap this whole mechanism exists for.
    expect(rule).not.toMatch(/background-image/);
    expect(rule).not.toMatch(/gradient/);
  });

  it("keeps the tint rule unlayered so it outranks @layer base", () => {
    // `body` gets bg-background from @layer base; an unlayered rule
    // wins over any layered one regardless of specificity, so the tint
    // must not be nested inside a @layer block.
    const upto = globals.slice(0, globals.indexOf("body:has([data-hero-chrome])"));
    const opened = (upto.match(/@layer[^{]*\{/g) ?? []).length;
    const closed = (upto.match(/^\}/gm) ?? []).length;
    expect(opened).toBeLessThanOrEqual(closed);
  });

  it("defines a light, dark, and desktop tint matching the art", () => {
    expect(globals).toMatch(/--hero-chrome-tint:\s*#8e8379/);
    expect(globals).toMatch(/--hero-chrome-tint:\s*#232c39/);
    expect(globals).toMatch(/--hero-chrome-tint:\s*#857f71/);
    expect(globals).toMatch(/--hero-chrome-tint:\s*#122028/);
    // The swap has to happen where <HeroBackground /> swaps masters,
    // not at the `nav` layout breakpoint.
    expect(globals).toMatch(
      /@media \(min-width: 768px\) \{[\s\S]*?--hero-chrome-tint/
    );
  });

  it("does not reintroduce the fixed/sticky sampler strip", () => {
    // Tried and rejected: a sticky strip at its natural offset was not
    // picked up on an iPhone, and a fixed one would leave a 6px band of
    // the hero's colour pinned over the cream marketing sections.
    expect(heroBackground).not.toMatch(/HeroChromeTint/);
    expect(page).not.toMatch(/HeroChromeTint/);
  });
});
