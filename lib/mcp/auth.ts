import { eq } from "drizzle-orm";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { db } from "@/lib/db";
import { personalAccessTokens } from "@/lib/db/schema";
import { hashToken, looksLikeMaterializeToken } from "./tokens";
import { type Scope } from "./scopes";

export interface MaterializeAuthExtra extends Record<string, unknown> {
  userId: string;
  tokenId: string;
  tokenName: string;
  scopes: Scope[];
}

export interface MaterializeAuthInfo extends AuthInfo {
  extra: MaterializeAuthExtra;
}

const TOKEN_LAST_USED_BACKOFF_MS = 60_000;

export async function verifyMaterializeToken(
  _req: Request,
  bearerToken: string | undefined
): Promise<MaterializeAuthInfo | undefined> {
  if (!bearerToken || !looksLikeMaterializeToken(bearerToken)) return undefined;

  const tokenHash = hashToken(bearerToken);
  const [row] = await db
    .select()
    .from(personalAccessTokens)
    .where(eq(personalAccessTokens.tokenHash, tokenHash))
    .limit(1);

  if (!row) return undefined;
  if (row.revokedAt) return undefined;
  if (row.expiresAt && row.expiresAt.getTime() < Date.now()) return undefined;

  if (
    !row.lastUsedAt ||
    Date.now() - row.lastUsedAt.getTime() > TOKEN_LAST_USED_BACKOFF_MS
  ) {
    await db
      .update(personalAccessTokens)
      .set({ lastUsedAt: new Date() })
      .where(eq(personalAccessTokens.id, row.id));
  }

  return {
    token: bearerToken,
    clientId: row.id,
    scopes: row.scopes,
    extra: {
      userId: row.userId,
      tokenId: row.id,
      tokenName: row.name,
      scopes: row.scopes as Scope[],
    },
  };
}

export class MissingScopeError extends Error {
  constructor(public readonly scope: Scope) {
    super(`Missing required scope: ${scope}`);
    this.name = "MissingScopeError";
  }
}

export function requireScope(
  authExtra: MaterializeAuthExtra,
  scope: Scope
): void {
  if (!authExtra.scopes.includes(scope)) {
    throw new MissingScopeError(scope);
  }
}
