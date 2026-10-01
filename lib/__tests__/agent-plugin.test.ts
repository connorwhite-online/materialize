/**
 * The agent plugin (plugins/materialize) ships a copy of the repo-root
 * skill, because `npx skills install` reads skills/ while plugin hosts
 * read the plugin folder. Pin the copy so the two can't drift.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, it, expect } from "vitest";

const root = process.cwd();
const pluginRoot = join(root, "plugins/materialize");

function listFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? listFiles(path) : [path];
  });
}

describe("materialize agent plugin", () => {
  it("bundles an exact copy of skills/materialize", () => {
    const source = join(root, "skills/materialize");
    const copy = join(pluginRoot, "skills/materialize");
    const rel = (base: string) => listFiles(base).map((f) => relative(base, f)).sort();
    expect(rel(copy)).toEqual(rel(source));
    for (const file of rel(source)) {
      expect(
        readFileSync(join(copy, file), "utf8"),
        `plugins/materialize/skills/materialize/${file} is stale; re-copy skills/materialize`
      ).toBe(readFileSync(join(source, file), "utf8"));
    }
  });

  it("points at the hosted MCP endpoint over streamable HTTP", () => {
    const mcp = JSON.parse(readFileSync(join(pluginRoot, "mcp.json"), "utf8"));
    expect(mcp.mcpServers.materialize).toEqual({
      type: "streamable-http",
      url: "https://materialize.cc/api/mcp",
    });
  });

  it("has a manifest whose relative paths exist", () => {
    const manifest = JSON.parse(readFileSync(join(pluginRoot, "plugin.json"), "utf8"));
    expect(manifest.name).toBe("materialize");
    const ui = manifest.extensions["com.openai"].interface;
    for (const path of [ui.composerIcon, ui.logo]) {
      expect(path).toMatch(/^\.\//);
      expect(statSync(join(pluginRoot, path)).isFile()).toBe(true);
    }
  });

  it("is listed in the repo marketplace", () => {
    const market = JSON.parse(
      readFileSync(join(root, ".agents/plugins/marketplace.json"), "utf8")
    );
    const entry = market.plugins.find((p: { name: string }) => p.name === "materialize");
    expect(entry.source.path).toBe("./plugins/materialize");
  });
});
