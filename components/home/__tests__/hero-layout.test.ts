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

  it("places desktop copy below center, not vertically centered", () => {
    expect(page).toMatch(/\bnav:pb-24\b/);
    expect(page).not.toMatch(/\bnav:items-center\b/);
    expect(page).not.toMatch(/\bnav:pb-0\b/);
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
