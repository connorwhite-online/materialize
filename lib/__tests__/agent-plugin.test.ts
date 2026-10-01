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
      url: "https://www.materialize.cc/api/mcp",
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

  it("meets OpenAI's submission limits for listing text and review cases", () => {
    const openai = JSON.parse(readFileSync(join(pluginRoot, "plugin.json"), "utf8"))
      .extensions["com.openai"];
    const ui = openai.interface;
    expect(ui.displayName.length).toBeLessThanOrEqual(30);
    expect(ui.shortDescription.length).toBeLessThanOrEqual(30);
    expect(ui.longDescription.length).toBeLessThanOrEqual(4000);
    expect(ui.defaultPrompt.length).toBeLessThanOrEqual(3);
    for (const p of ui.defaultPrompt) expect(p.length).toBeLessThanOrEqual(128);
    for (const key of ["websiteURL", "supportURL", "privacyPolicyURL", "termsOfServiceURL"]) {
      expect(ui[key], key).toMatch(/^https:\/\//);
    }
    // Initial MCP review needs exactly five positive and three negative.
    expect(openai.review.test_cases.positive).toHaveLength(5);
    expect(openai.review.test_cases.negative).toHaveLength(3);
    // The package rejects these; reviewer access goes in the dashboard.
    expect(openai.review).not.toHaveProperty("test_credentials");
    expect(openai.review).not.toHaveProperty("reviewer_instructions");
  });

  it("names only registered MCP tools in its review cases", () => {
    const routeSource = readFileSync(join(root, "app/api/[transport]/route.ts"), "utf8");
    const registered = new Set(
      [...routeSource.matchAll(/registerTool\(\s*"(materialize_[a-z_]+)"/g)].map((m) => m[1])
    );
    const openai = JSON.parse(readFileSync(join(pluginRoot, "plugin.json"), "utf8"))
      .extensions["com.openai"];
    for (const c of openai.review.test_cases.positive) {
      for (const tool of c.tools_triggered.split(/,\s*/)) {
        expect(registered.has(tool), `${c.description}: ${tool}`).toBe(true);
      }
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
