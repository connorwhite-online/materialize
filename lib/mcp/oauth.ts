import { and, eq, isNotNull } from "drizzle-orm";
import { clerkClient } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import { personalAccessTokens } from "@/lib/db/schema";
import { logError } from "@/lib/logger";
import { ensureUserRow } from "@/lib/users/ensure-user-row";
import { hashToken } from "./tokens";
import { ALL_SCOPES, type Scope } from "./scopes";
import type { MaterializeAuthInfo } from "./auth";

/**
 * OAuth 2.1 for the MCP server, with Clerk as the authorization server.
 *
 * ChatGPT apps and Claude connectors both sign in through the MCP
 * authorization spec: authorization code + PKCE, with dynamic client
 * registration, against the authorization server named in our
 * protected-resource metadata (`/.well-known/oauth-protected-resource`).
 * Clerk is that server — it already owns the user's session, so the
 * consent screen is a normal Materialize sign-in. DCR must be switched
 * on in the Clerk dashboard (OAuth applications → Settings).
 *
 * Personal access tokens keep working unchanged; `verifyMaterializeToken`
 * routes anything that isn't `mtl_pat_…` here.
 *
 * Every OAuth client a user connects is mirrored into
 * `personal_access_tokens` as a *connection row* (`oauthClientId` set,
 * no usable secret). That row is what the rest of the MCP stack already
 * keys on: `tokenId` for the agent-order audit trail and the spending
 * policy + ledger, `name` for the "via ChatGPT" line on the confirm
 * page, and `revokedAt` for the settings page's Revoke button. Revoking
 * a connection blocks that client for this user outright — Clerk's
 * refresh tokens keep minting fresh access tokens, so "reject tokens
 * issued before the revocation" would quietly reconnect it.
 */

/**
 * Clerk custom OAuth scopes don't exist (its scopes describe the userinfo
 * payload), so a connected app gets the full tool surface. The owner-only
 * gates (CAD access, order confirmation by email/web) still apply on top.
 */
export const OAUTH_CONNECTION_SCOPES: Scope[] = [...ALL_SCOPES];

const CONNECTION_PREFIX = "oauth";
const LAST_USED_BACKOFF_MS = 60_000;

/**
 * The authorization server's issuer URL, derived from the Clerk
 * publishable key (`pk_(test|live)_<base64("<frontend-api>$")>`) so there
 * is no second env var to drift. Returns null when the key is missing or
 * malformed — the metadata routes then 404 rather than advertise a
 * server that doesn't exist.
 */
export function clerkIssuerUrl(
  publishableKey: string | undefined = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
): string | null {
  const match = publishableKey?.match(/^pk_(?:test|live)_(.+)$/);
  if (!match) return null;
  let decoded: string;
  try {
    decoded = Buffer.from(match[1], "base64").toString("utf8");
  } catch {
    return null;
  }
  if (!decoded.endsWith("$")) return null;
  const host = decoded.slice(0, -1);
  if (!/^[a-z0-9.-]+$/i.test(host)) return null;
  return `https://${host}`;
}

/**
 * Verify a Clerk-issued OAuth access token and resolve it to the user's
 * connection row. Returns undefined for anything that isn't a live
 * token, which `withMcpAuth` turns into a 401 + `WWW-Authenticate`
 * pointing at the resource metadata (the client's cue to re-auth).
 */
export async function verifyOAuthAccessToken(
  bearerToken: string
): Promise<MaterializeAuthInfo | undefined> {
  let token: {
    clientId: string;
    subject: string;
    revoked: boolean;
    expired: boolean;
    expiration: number | null;
  };
  try {
    const client = await clerkClient();
    token = await client.idPOAuthAccessToken.verify(bearerToken);
  } catch {
    // Unknown, malformed or foreign tokens all land here. Not an error
    // worth logging — any bearer that isn't a PAT is tried this way.
    return undefined;
  }
  if (token.revoked || token.expired) return undefined;
  if (!token.subject?.startsWith("user_") || !token.clientId) return undefined;

  const connection = await resolveOAuthConnection({
    userId: token.subject,
    clientId: token.clientId,
  });
  if (!connection) return undefined;
  await touchLastUsed(connection);

  return {
    token: bearerToken,
    clientId: token.clientId,
    scopes: connection.scopes,
    // Clerk reports milliseconds; AuthInfo.expiresAt is seconds.
    expiresAt:
      token.expiration != null ? Math.floor(token.expiration / 1000) : undefined,
    extra: {
      userId: token.subject,
      tokenId: connection.id,
      tokenName: connection.name,
      scopes: connection.scopes,
    },
  };
}

/**
 * The connection row for (user, client), created on first use. Returns
 * null when the user revoked it.
 *
 * The row's `tokenHash` is a hash of a fixed string, not a secret: it
 * only satisfies the column's NOT NULL + unique constraints. It can never
 * match a presented bearer, because PAT lookup only runs for `mtl_pat_…`
 * tokens and hashes the raw bearer.
 */
export async function resolveOAuthConnection(input: {
  userId: string;
  clientId: string;
}): Promise<Connection | null> {
  const existing = await findConnection(input);
  if (existing) return existing.revokedAt ? null : existing;

  // The connection row's FK needs the users row, which the Clerk
  // webhook may not have written yet (or ever, if it missed).
  if (!(await ensureUserRow(input.userId))) return null;

  const name = await oauthClientName(input.clientId);
  try {
    await db
      .insert(personalAccessTokens)
      .values({
        userId: input.userId,
        name,
        tokenHash: hashToken(
          `${CONNECTION_PREFIX}:${input.userId}:${input.clientId}`
        ),
        prefix: CONNECTION_PREFIX,
        scopes: OAUTH_CONNECTION_SCOPES,
        oauthClientId: input.clientId,
      })
      .onConflictDoNothing();
  } catch (err) {
    // Refuse the token rather than 500 the whole MCP request.
    logError("mcp.oauth.createConnection", err);
    return null;
  }
  // Re-read so two first requests racing each other converge on one row.
  const row = await findConnection(input);
  if (!row || row.revokedAt) return null;
  return row;
}

interface Connection {
  id: string;
  name: string;
  scopes: Scope[];
  lastUsedAt: Date | null;
  revokedAt: Date | null;
}

async function findConnection(input: {
  userId: string;
  clientId: string;
}): Promise<Connection | null> {
  const [row] = await db
    .select({
      id: personalAccessTokens.id,
      name: personalAccessTokens.name,
      scopes: personalAccessTokens.scopes,
      lastUsedAt: personalAccessTokens.lastUsedAt,
      revokedAt: personalAccessTokens.revokedAt,
    })
    .from(personalAccessTokens)
    .where(
      and(
        eq(personalAccessTokens.userId, input.userId),
        isNotNull(personalAccessTokens.oauthClientId),
        eq(personalAccessTokens.oauthClientId, input.clientId)
      )
    )
    .limit(1);
  if (!row) return null;
  return { ...row, scopes: row.scopes as Scope[] };
}

/** Same write backoff as PAT lookups in auth.ts: at most once a minute. */
async function touchLastUsed(connection: Connection) {
  if (
    connection.lastUsedAt &&
    Date.now() - connection.lastUsedAt.getTime() <= LAST_USED_BACKOFF_MS
  ) {
    return;
  }
  await db
    .update(personalAccessTokens)
    .set({ lastUsedAt: new Date() })
    .where(eq(personalAccessTokens.id, connection.id));
}

/**
 * The client's registered name ("ChatGPT", "Claude"), shown on the
 * settings page and on agent-order confirmations. Dynamically registered
 * clients carry the `client_name` they registered with. Best-effort:
 * falls back to a generic label rather than fail the sign-in.
 */
async function oauthClientName(clientId: string): Promise<string> {
  // Clients that sign in with a Client ID Metadata Document (ChatGPT
  // does whenever the server supports it) use the document's URL as
  // their client id and have no Clerk application to look up.
  const cimdName = clientNameFromMetadataUrl(clientId);
  if (cimdName) return cimdName;
  try {
    // Newest first by default, and the client registered moments before
    // this first token, so page one is where it is. Instances collect an
    // application per registration, so never walk the whole list.
    const client = await clerkClient();
    const page = await client.oauthApplications.list({ limit: 100 });
    const app = page.data.find((a) => a.clientId === clientId);
    if (app?.name) return app.name.slice(0, 100);
  } catch (err) {
    logError("mcp.oauth.clientName", err);
  }
  return "Connected app";
}

const KNOWN_CLIENT_HOSTS: Record<string, string> = {
  "chatgpt.com": "ChatGPT",
  "claude.ai": "Claude",
};

/**
 * A display name for a CIMD client id (`https://chatgpt.com/oauth/client.json`):
 * a known product name, else the bare host. Null for an ordinary Clerk
 * client id. Deliberately doesn't fetch the document: Clerk already did,
 * and the host is the part a user can check.
 */
export function clientNameFromMetadataUrl(clientId: string): string | null {
  let url: URL;
  try {
    url = new URL(clientId);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  const host = url.hostname.replace(/^www\./, "");
  return KNOWN_CLIENT_HOSTS[host] ?? host.slice(0, 100);
}
