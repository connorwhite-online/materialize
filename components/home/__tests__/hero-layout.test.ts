import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Pin the anon-home hero layout contracts. These are easy to regress
 * from a Tailwind class shuffle — iOS 26 Safari in particular treats
 * `vh`/`dvh` as taller than the visible first screen.
 */
const page = readFileSync(resolve(__dirname, "../../../app/page.tsx"), "utf8");
const classNames = [...page.matchAll(/className="([^"]*)"/g)]
  .map((match) => match[1])
  .join(" ");

describe("anon home hero layout", () => {
  it("sizes the first screen to svh, not dvh/vh", () => {
    expect(classNames).toMatch(/\bh-svh\b/);
    expect(classNames).not.toMatch(/\bmin-h-dvh\b/);
    expect(classNames).not.toMatch(/\bh-dvh\b/);
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
