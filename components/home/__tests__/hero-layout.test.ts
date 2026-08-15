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
const homeMarketing = readFileSync(
  resolve(__dirname, "../home-marketing.tsx"),
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
  it("paints the photo to 110dvh while keeping copy on svh", () => {
    expect(classNames).toMatch(/\bh-\[110dvh\]/);
    expect(classNames).toMatch(/min-h-\[110dvh\]/);
    expect(classNames).toMatch(/\bh-svh\b/);
    expect(classNames).not.toMatch(/\bnav:h-full\b/);
  });

  it("feathers the bottom of the photo into the page background", () => {
    expect(heroBackground).toMatch(
      /bottom-0[^"]*h-\[20dvh\][^"]*bg-gradient-to-b[^"]*from-transparent[^"]*to-home-marketing/
    );
    expect(homeMarketing).toMatch(/className="bg-home-marketing"/);
    expect(homeMarketing).not.toMatch(/border-t/);
  });

  it("covers the iOS unsafe areas so the photo can sit under chrome", () => {
    expect(layout).toMatch(/viewportFit:\s*"cover"/);
  });

  it("places mobile copy below center, padded above the floating pill", () => {
    // Assert on the copy container itself: `pb-*` also appears on the
    // marketing wrapper below the fold, so matching the whole file would
    // pass on the wrong element.
    const copy = page.match(/<div className="(flex flex-1 items-end[^"]*)">/)?.[1];
    expect(copy).toBeDefined();
    expect(copy).toMatch(/\bitems-end\b/);
    expect(copy).toMatch(/\bpb-28\b/);
    expect(copy).not.toMatch(/\bpt-16\b/);
  });

  it("places desktop copy below center, not vertically centered", () => {
    const copy = page.match(
      /<div className="(flex flex-1 items-end[^"]*)">/
    )?.[1];
    expect(copy).toBeDefined();
    expect(copy).toMatch(/\bnav:pb-24\b/);
    expect(copy).not.toMatch(/\bnav:items-center\b/);
    expect(copy).not.toMatch(/\bnav:pb-0\b/);
  });

  it("asks TopBar for the landing wordmark and blur feather", () => {
    expect(page).toMatch(/<TopBar\s+landing\b/);
  });

  it("paints the subheading darker than muted-foreground, with no glow", () => {
    expect(classNames).toMatch(/text-foreground\/90/);
    const sub = page.match(
      /<p className="([^"]*)">\s*Get prints delivered to your door/
    );
    expect(sub?.[1]).toBeDefined();
    expect(sub?.[1]).not.toMatch(/text-muted-foreground/);
    expect(sub?.[1]).not.toMatch(/text-shadow/);
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

/**
 * iOS 26 owns the status-bar band and we cannot paint into it (see the
 * `--hero-chrome-tint` comment in globals.css). The top feather is what
 * turns that unavoidable join from a hard edge into a soft one, so both
 * halves of the trick — the token it fades to, and the fact that it is
 * mobile-only — are worth pinning.
 */
describe("anon home hero top feather", () => {
  const feather = heroBackground.match(
    /className="pointer-events-none absolute inset-x-0 top-0[^"]*"/
  )?.[0];

  it("fades the top of the art into the same token the band uses", () => {
    expect(feather).toBeDefined();
    expect(feather).toMatch(/from-hero-chrome-tint/);
    expect(feather).not.toMatch(/home-marketing/);
  });

  it("is mobile-only — desktop has no status-bar band to hide", () => {
    expect(feather).toMatch(/\bmd:hidden\b/);
  });

  it("still feathers the bottom into the marketing surface", () => {
    expect(heroBackground).toMatch(/bottom-0[^"]*to-home-marketing/);
  });
});
