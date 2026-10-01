import {
  metadataCorsOptionsRequestHandler,
  protectedResourceHandler,
} from "mcp-handler";
import { clerkIssuerUrl } from "@/lib/mcp/oauth";

/**
 * RFC 9728 protected-resource metadata for the MCP server. A 401 from
 * /api/mcp carries `WWW-Authenticate: Bearer resource_metadata=…` pointing
 * here; ChatGPT and Claude read `authorization_servers` from it and run the
 * OAuth flow against Clerk. The resource is derived from the request
 * origin (forwarding headers included), never from NEXT_PUBLIC_APP_URL —
 * see "Stripe redirect URL" in AGENTS.md for why.
 */
export function GET(req: Request) {
  const issuer = clerkIssuerUrl();
  if (!issuer) return new Response("Not found", { status: 404 });
  return protectedResourceHandler({ authServerUrls: [issuer] })(req);
}

export const OPTIONS = metadataCorsOptionsRequestHandler();
