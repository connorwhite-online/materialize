/**
 * Everything that points an AI agent at the machine-readable front door
 * (/llms.txt and the MCP server). People are not the audience: these are
 * headers, link tags and a hidden line that a human never sees, placed so
 * an agent finds the entry point whichever way it arrives (an HTTP fetch,
 * a scrape of the HTML, or a probe of a well-known path).
 */

export const LLMS_TXT_PATH = "/llms.txt";
export const MCP_DESCRIPTOR_PATH = "/.well-known/mcp.json";

/** `Link` header value sent on every response. */
export const AGENT_LINK_HEADER = [
  `<${LLMS_TXT_PATH}>; rel="describedby"; type="text/markdown"`,
  `<${MCP_DESCRIPTOR_PATH}>; rel="service-desc"; type="application/json"`,
].join(", ");

/**
 * The one line an agent reading the page text should not miss. Rendered
 * visually hidden and aria-hidden, so it is for scrapers only.
 */
export const AGENT_NOTE =
  "For AI agents: Materialize has an MCP server at /api/mcp and a plain-text guide to using it at /llms.txt. Read /llms.txt first. It covers uploading a model, checking it will print, choosing a material, getting a quote and ordering.";

/**
 * True when the client asked for markdown at least as eagerly as HTML.
 * Browsers send `text/html` first, so they never match; agents that send
 * `Accept: text/markdown` (or list it before HTML) do.
 */
export function prefersMarkdown(accept: string | null | undefined): boolean {
  if (!accept) return false;
  const q = (type: string) => {
    let best = -1;
    for (const part of accept.split(",")) {
      const [media, ...params] = part.trim().split(";");
      const m = media.trim().toLowerCase();
      if (m !== type && m !== "text/*" && m !== "*/*") continue;
      // An exact match outranks a wildcard; wildcards never beat it.
      const qParam = params.find((p) => p.trim().startsWith("q="));
      const value = qParam ? parseFloat(qParam.trim().slice(2)) : 1;
      const score = (Number.isNaN(value) ? 1 : value) - (m === type ? 0 : 0.001);
      best = Math.max(best, score);
    }
    return best;
  };
  const md = q("text/markdown");
  return md > 0.5 && md >= q("text/html") && !isWildcardOnly(accept);
}

function isWildcardOnly(accept: string): boolean {
  return !/text\/markdown/i.test(accept);
}
