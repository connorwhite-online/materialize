import { deriveAppUrl } from "@/lib/utils/request-url";
import { mcpDescriptor } from "@/lib/seo/mcp-descriptor";

/** Machine-readable pointer to the MCP server, for agents that probe well-known paths. */
export async function GET() {
  const url = await deriveAppUrl();
  return Response.json(mcpDescriptor(url), {
    headers: { "cache-control": "public, max-age=3600" },
  });
}
