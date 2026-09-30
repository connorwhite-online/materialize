import { metadataCorsOptionsRequestHandler } from "mcp-handler";
import { clerkIssuerUrl } from "@/lib/mcp/oauth";
import { logError } from "@/lib/logger";

/**
 * RFC 8414 authorization-server metadata, mirrored from Clerk.
 *
 * Clients on the current MCP auth spec find Clerk through
 * /.well-known/oauth-protected-resource and fetch its metadata directly.
 * Older clients (the 2025-03-26 spec) look for this document on the MCP
 * server's own origin instead, so we serve Clerk's copy here. The
 * endpoints inside still point at Clerk; nothing about the flow is
 * proxied except this one read.
 */
export async function GET() {
  const issuer = clerkIssuerUrl();
  if (!issuer) return new Response("Not found", { status: 404 });
  try {
    const res = await fetch(`${issuer}/.well-known/oauth-authorization-server`, {
      next: { revalidate: 3600 },
    });
    if (!res.ok) throw new Error(`Clerk metadata ${res.status}`);
    return Response.json(await res.json(), {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch (err) {
    logError("mcp.oauth.authServerMetadata", err);
    return new Response("Authorization server metadata unavailable", {
      status: 502,
    });
  }
}

export const OPTIONS = metadataCorsOptionsRequestHandler();
