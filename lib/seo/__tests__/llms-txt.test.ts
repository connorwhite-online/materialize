import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { llmsTxt } from "../llms-txt";

const routeSource = readFileSync(
  join(process.cwd(), "app/api/[transport]/route.ts"),
  "utf8"
);
const registeredTools = new Set(
  [...routeSource.matchAll(/registerTool\(\s*"(materialize_[a-z_]+)"/g)].map((m) => m[1])
);

describe("llms.txt", () => {
  const body = llmsTxt("https://example.test");

  it("names only tools the MCP server registers", () => {
    expect(registeredTools.size).toBeGreaterThan(10);
    const named = [...body.matchAll(/materialize_[a-z_]+\*?/g)].map((m) => m[0]);
    expect(named.length).toBeGreaterThan(0);
    for (const name of named) {
      const exists = name.endsWith("*")
        ? [...registeredTools].some((t) => t.startsWith(name.slice(0, -1)))
        : registeredTools.has(name);
      expect(exists, `${name} is not a registered MCP tool`).toBe(true);
    }
  });

  it("builds every link from the request's base URL", () => {
    expect(body).toContain("https://example.test/api/mcp");
    expect(body).not.toMatch(/localhost|materialize\.cc/);
  });

  it("opens with the H1 and blockquote summary llmstxt.org expects", () => {
    expect(body).toMatch(/^# Materialize\n\n> /);
  });
});
