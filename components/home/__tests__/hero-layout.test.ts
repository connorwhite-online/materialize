import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Pin the anon-home layout contracts. These are easy to regress from a
 * Tailwind class shuffle.
 */
const page = readFileSync(resolve(__dirname, "../../../app/page.tsx"), "utf8");
const layout = readFileSync(resolve(__dirname, "../../../app/layout.tsx"), "utf8");
const landingHero = readFileSync(
  resolve(__dirname, "../../landing/landing-hero.tsx"),
  "utf8"
);
const materials = readFileSync(
  resolve(__dirname, "../../landing/landing-materials.ts"),
  "utf8"
);
const globals = readFileSync(
  resolve(__dirname, "../../../app/globals.css"),
  "utf8"
);

describe("anon home hero layout", () => {
  it("tells the story on one screen, then pulls the FAQ sheet up over it", () => {
    expect(page).toMatch(/<EnclosureStage \/>/);
    expect(page).toMatch(/<StepCarousel \/>/);
    expect(landingHero).toMatch(/\bh-svh\b/);
    // No scroll-driven sections and no snapping — the stepper replaced them.
    expect(page).not.toMatch(/data-landing-section/);
    expect(globals).not.toMatch(/scroll-snap-type/);
    // Contained card, not a full-width sheet.
    const card = page.match(/<div className="(glass-surface[^"]*)">\s*<HomeFaq/)?.[1];
    expect(card).toMatch(/\bmax-w-4xl\b/);
    expect(card).toMatch(/\brounded-3xl\b/);
    expect(page).toMatch(/title="Questions & Answers"/);
    // Full-height FAQ screen: card at the top clear of the nav, footer
    // pushed to the bottom.
    expect(page).toMatch(/className="relative z-10 flex min-h-svh flex-col[^"]*pt-24/);
    expect(page).toMatch(/<div className="mt-auto">\s*<LandingFooter \/>/);
    expect(page.indexOf("<LandingFooter")).toBeGreaterThan(page.indexOf("<HomeFaq"));
  });

  it("covers the iOS unsafe areas", () => {
    expect(layout).toMatch(/viewportFit:\s*"cover"/);
  });

  it("places copy below center, clear of the stepper and the floating pill", () => {
    const copy = page.match(/<main\b[^>]*?className="(flex flex-1 items-end[^"]*)"/)?.[1];
    expect(copy).toBeDefined();
    expect(copy).toMatch(/\bpb-28\b/);
    expect(copy).toMatch(/\bnav:pb-24\b/);
    // Copy stays left-aligned on desktop; only the stage and stepper centre.
    expect(copy).not.toMatch(/\bnav:justify-center\b/);
    expect(landingHero).not.toMatch(/nav:text-center/);
    // Opposite the nav: top on mobile (bottom pill), bottom on desktop.
    expect(landingHero).toMatch(/top-\[[^"]*nav:top-auto nav:bottom-8/);
  });

  it("renders a static headline: 'Print anything,' then a line break", () => {
    expect(landingHero).toMatch(/Print anything,\s*<br \/>\s*share your ideas/);
    expect(landingHero).not.toMatch(/HeroWord|INTRO_SEQUENCE/);
  });

  it("asks TopBar for the landing wordmark and blur feather", () => {
    expect(page).toMatch(/<TopBar\s+landing\b/);
  });

  it("server-renders the product pitch as the first step's caption", () => {
    expect(landingHero).toMatch(/Print in 200\+ materials right where you keep your files/);
    expect(landingHero).toMatch(/text-foreground\/90/);
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
