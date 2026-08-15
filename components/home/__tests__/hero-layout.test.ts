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
 * The chrome bands are shared by BOTH edges, the whole route, and every
 * state (menu open, auth modal). Tinting <body> to the hero's top-edge
 * colour was tried and reverted — it matched the top of the photo and
 * mismatched everything else, worst in dark mode. Leaving <body> on
 * --background is the only honest thing one colour can do, so this
 * guards the revert.
 */
describe("anon home browser-chrome bands", () => {
  it("does not tint <body> for the hero", () => {
    expect(globals).not.toMatch(/body:has\(\[data-hero-chrome\]\)\s*\{/);
    expect(globals).not.toMatch(/--hero-chrome-tint:/);
    expect(page).not.toMatch(/data-hero-chrome/);
  });

  it("keeps the hero comment explaining why, so it isn't re-added", () => {
    expect(globals).toMatch(/BOTH bands/);
  });
});

/**
 * iOS 26 owns the status-bar band and fills it with <body>'s colour.
 * The top feather is what turns that unavoidable join from a hard edge
 * into a soft one, so both halves — the colour it fades to, and the fact
 * that it is mobile-only — are worth pinning.
 */
describe("anon home hero top feather", () => {
  const feather = heroBackground.match(
    /className="pointer-events-none absolute inset-x-0 top-0[^"]*"/
  )?.[0];

  it("fades the top of the art into the colour the band will be", () => {
    expect(feather).toBeDefined();
    // --background is <body>'s colour, which is what Safari samples.
    expect(feather).toMatch(/from-background/);
    expect(feather).not.toMatch(/home-marketing/);
  });

  it("is mobile-only — desktop has no status-bar band to hide", () => {
    expect(feather).toMatch(/\bmd:hidden\b/);
  });

  it("still feathers the bottom into the marketing surface", () => {
    expect(heroBackground).toMatch(/bottom-0[^"]*to-home-marketing/);
  });
});
