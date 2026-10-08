import { describe, it, expect } from "vitest";
import { prefersMarkdown, AGENT_NOTE, AGENT_LINK_HEADER } from "../agent-discovery";
import { mcpDescriptor } from "../mcp-descriptor";

describe("prefersMarkdown", () => {
  it.each([
    "text/markdown",
    "text/markdown, text/html;q=0.8",
    "text/markdown;q=1.0, */*;q=0.1",
  ])("serves markdown for %s", (a) => expect(prefersMarkdown(a)).toBe(true));

  it.each([
    undefined,
    "",
    "*/*",
    "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "text/html, text/markdown;q=0.5",
  ])("serves HTML for %s", (a) => expect(prefersMarkdown(a)).toBe(false));
});

describe("agent pointers", () => {
  it("names the guide and the descriptor", () => {
    expect(AGENT_NOTE).toContain("/llms.txt");
    expect(AGENT_NOTE).toContain("/api/mcp");
    expect(AGENT_LINK_HEADER).toContain("/llms.txt");
    expect(AGENT_LINK_HEADER).toContain("/.well-known/mcp.json");
  });

  it("keeps the next.config.ts Link header in step", async () => {
    const { readFileSync } = await import("node:fs");
    const cfg = readFileSync("next.config.ts", "utf8");
    expect(cfg).toContain('</llms.txt>; rel="describedby"; type="text/markdown"');
    expect(cfg).toContain('</.well-known/mcp.json>; rel="service-desc"; type="application/json"');
  });

  it("builds the descriptor from the request origin", () => {
    const d = mcpDescriptor("https://example.test");
    expect(d.mcp.url).toBe("https://example.test/api/mcp");
    expect(JSON.stringify(d)).not.toMatch(/localhost|materialize\.cc/);
  });
});
