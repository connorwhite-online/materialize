import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";

const filesDir = resolve(__dirname, "..");

/**
 * Next wraps a segment's loading.tsx around that segment AND its
 * children. A loading.tsx sitting on `files/` therefore paints the
 * browse grid onto `/files/[slug]` (CON-37). Browse fallback must
 * live in a sibling route group so the detail route keeps its own.
 */
describe("files loading.tsx scope", () => {
  it("does not put a loading.tsx on the shared files/ segment", () => {
    expect(existsSync(resolve(filesDir, "loading.tsx"))).toBe(false);
  });

  it("keeps browse loading inside the (browse) route group", () => {
    expect(existsSync(resolve(filesDir, "(browse)/loading.tsx"))).toBe(true);
    expect(existsSync(resolve(filesDir, "(browse)/page.tsx"))).toBe(true);
  });

  it("keeps a dedicated file-page loading.tsx under [slug]", () => {
    expect(existsSync(resolve(filesDir, "[slug]/loading.tsx"))).toBe(true);
  });
});
