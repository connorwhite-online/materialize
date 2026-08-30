import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(__dirname, "../..");

function read(rel: string) {
  return readFileSync(resolve(root, rel), "utf8");
}

/**
 * Iterate was a local visual-editing overlay, not product. These pins
 * keep the adapter, overlay, and npm package from being reintroduced
 * by a leftover skill or a stale config copy.
 */
describe("iterate is uninstalled", () => {
  it("does not wrap next.config with withIterate", () => {
    const config = read("next.config.ts");
    expect(config).not.toMatch(/iterate-ui-next/);
    expect(config).not.toMatch(/withIterate/);
    expect(config).toMatch(/withSentryConfig\(nextConfig/);
  });

  it("does not mount <Iterate /> in the root layout", () => {
    const layout = read("app/layout.tsx");
    expect(layout).not.toMatch(/iterate-ui-next/);
    expect(layout).not.toMatch(/<Iterate\b/);
  });

  it("does not declare iterate-ui-next as a dependency", () => {
    const pkg = JSON.parse(read("package.json")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    expect(pkg.dependencies?.["iterate-ui-next"]).toBeUndefined();
    expect(pkg.devDependencies?.["iterate-ui-next"]).toBeUndefined();
  });
});
