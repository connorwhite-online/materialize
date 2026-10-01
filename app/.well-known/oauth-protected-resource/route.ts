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
/**
 * OpenAI's plugin review requires OAuth servers to advertise `openid` and
 * `email`, so a workspace can restrict sign-in to its own email domain
 * (Clerk's UserInfo endpoint returns `email` + `email_verified`). Both
 * scopes must also be enabled for OAuth applications in the Clerk
 * dashboard; advertising them here doesn't turn them on.
 */
const SCOPES_SUPPORTED = ["openid", "email"];

export async function GET(req: Request) {
  const issuer = clerkIssuerUrl();
  if (!issuer) return new Response("Not found", { status: 404 });
  const res = protectedResourceHandler({ authServerUrls: [issuer] })(req);
  const metadata = await res.json();
  return new Response(
    JSON.stringify({ ...metadata, scopes_supported: SCOPES_SUPPORTED }),
    { status: res.status, headers: res.headers }
  );
}

export const OPTIONS = metadataCorsOptionsRequestHandler();
