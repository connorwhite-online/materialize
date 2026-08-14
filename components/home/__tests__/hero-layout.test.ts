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
 * iOS 26 Safari fills the status-bar band with a colour sampled from
 * the page, and `<meta name="theme-color">` no longer feeds it. The
 * only input we control is the background-color of a fixed/sticky
 * element near the viewport's top edge — so these assertions guard the
 * properties that make <HeroChromeTint /> sampleable at all. Break any
 * one of them and the band silently reverts to a cream `--background`
 * strip above the photo, which is a visual-only regression no type
 * check or render test would catch.
 */
describe("anon home browser-chrome tint", () => {
  const tintStrip = heroBackground.match(
    /export function HeroChromeTint\(\)[\s\S]*?className="([^"]*)"/
  )?.[1];

  it("renders the sampler above the hero art", () => {
    expect(page).toMatch(/<HeroChromeTint \/>/);
    // The strip is a normal-flow sticky element: its static position
    // has to be the top of the hero, so it must precede the <section>.
    expect(page.indexOf("<HeroChromeTint />")).toBeLessThan(
      page.indexOf("<HeroBackground />")
    );
  });

  it("is sticky, full width, and tall enough for Safari to sample", () => {
    expect(tintStrip).toBeDefined();
    // Fixed would hold the hero's colour over the whole page; sticky
    // releases it when the hero scrolls away.
    expect(tintStrip).toMatch(/\bsticky\b/);
    expect(tintStrip).toMatch(/\btop-0\b/);
    expect(tintStrip).toMatch(/\bw-full\b/);
    // 6px — Safari ignores candidates only a pixel or two high.
    expect(tintStrip).toMatch(/\bh-1\.5\b/);
    // Costs the hero no layout.
    expect(tintStrip).toMatch(/-mb-1\.5/);
    expect(tintStrip).toMatch(/bg-\[var\(--hero-chrome-tint\)\]/);
  });

  it("carries no property that disqualifies it from sampling", () => {
    // Safari skips elements behind opacity, blur, or backdrop-filter,
    // and never reads pseudo-elements.
    expect(tintStrip).not.toMatch(/\bopacity-/);
    expect(tintStrip).not.toMatch(/backdrop-/);
    expect(tintStrip).not.toMatch(/\bblur\b/);
    expect(tintStrip).not.toMatch(/\bhidden\b/);
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

  it("leaves the bottom edge untinted", () => {
    // A sampler near the bottom would replace iOS 26's live blur under
    // the floating toolbar with a flat fill.
    expect(heroBackground).not.toMatch(/bottom-0[^"]*bg-\[var\(--hero-chrome-tint\)\]/);
  });
});
