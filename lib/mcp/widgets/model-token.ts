import "server-only";

import { createHash, createHmac } from "node:crypto";
import { constantTimeEqual } from "@/lib/auth/constant-time-equal";

/**
 * Signed, short-lived links to a model's bytes for the ChatGPT / Claude
 * widgets (lib/mcp/widgets).
 *
 * A widget runs in the host's sandboxed iframe on the host's origin, with
 * no Materialize session and no bearer token, so it can't use the
 * session-gated /api/files/preview proxy. The MCP tool that renders the
 * widget already proved the caller owns the asset; it mints this token
 * into the result, and /api/widget/model/[fileAssetId] serves the bytes
 * to whoever holds it until it expires.
 *
 * Same construction as lib/orders/pay-production-token.ts (HMAC keyed
 * off a hash of STRIPE_SECRET_KEY, different context string), so no new
 * env var. Format: `<expiresAtMs>.<base64url hmac of "<assetId>.<exp>">`.
 */

const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const KEY_CONTEXT = "materialize:widget-model-token:v1";

function signingKey(): Buffer {
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) {
    throw new Error(
      "widget-model-token: STRIPE_SECRET_KEY is not set — cannot derive signing key"
    );
  }
  return createHash("sha256").update(`${KEY_CONTEXT}:${stripeKey}`).digest();
}

function signature(fileAssetId: string, expiresAtMs: number): string {
  return createHmac("sha256", signingKey())
    .update(`${fileAssetId}.${expiresAtMs}`)
    .digest("base64url");
}

export function mintWidgetModelToken(
  fileAssetId: string,
  now: number = Date.now()
): string {
  const expiresAtMs = now + TOKEN_TTL_MS;
  return `${expiresAtMs}.${signature(fileAssetId, expiresAtMs)}`;
}

export function verifyWidgetModelToken(
  fileAssetId: string,
  token: string | null | undefined,
  now: number = Date.now()
): boolean {
  if (!token) return false;
  const dot = token.indexOf(".");
  if (dot <= 0) return false;
  const expiresAtMs = Number(token.slice(0, dot));
  if (!Number.isSafeInteger(expiresAtMs) || expiresAtMs < now) return false;
  try {
    return constantTimeEqual(
      token.slice(dot + 1),
      signature(fileAssetId, expiresAtMs)
    );
  } catch {
    return false;
  }
}
