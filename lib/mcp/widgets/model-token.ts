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
 * widget already proved the caller may see the asset; it mints this token
 * into the result, and /api/widget/model/[fileAssetId] serves the bytes
 * to whoever holds it until it expires.
 *
 * The token also carries WHICH bytes: `full` (the original) or `preview`
 * (the low-detail copy, lib/files/model-preview.ts). The minting caller
 * decides from entitlement — anyone quoting a paid listing they haven't
 * bought gets `preview` — and the variant is inside the HMAC, so a holder
 * can't upgrade it. The route still serves the original for a free file
 * whatever the variant says; the variant only matters for paid ones.
 *
 * Same construction as lib/orders/pay-production-token.ts (HMAC keyed
 * off a hash of STRIPE_SECRET_KEY, different context string), so no new
 * env var. Format: `<expiresAtMs>.<variant>.<base64url hmac of
 * "<assetId>.<exp>.<variant>">`. The original two-part format
 * (`<exp>.<hmac of "<assetId>.<exp>">`, minted before variants existed)
 * still verifies, as `preview` — it was minted without an entitlement
 * check, so it must not unlock a paid original.
 */

const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const KEY_CONTEXT = "materialize:widget-model-token:v1";

export type WidgetModelVariant = "full" | "preview";

function signingKey(): Buffer {
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) {
    throw new Error(
      "widget-model-token: STRIPE_SECRET_KEY is not set — cannot derive signing key"
    );
  }
  return createHash("sha256").update(`${KEY_CONTEXT}:${stripeKey}`).digest();
}

function signature(payload: string): string {
  return createHmac("sha256", signingKey()).update(payload).digest("base64url");
}

/**
 * Mint a token for one asset. `variant` defaults to `preview`, the safe
 * side: a caller that forgets to decide never hands out a paid original.
 */
export function mintWidgetModelToken(
  fileAssetId: string,
  now: number = Date.now(),
  variant: WidgetModelVariant = "preview"
): string {
  const expiresAtMs = now + TOKEN_TTL_MS;
  return `${expiresAtMs}.${variant}.${signature(`${fileAssetId}.${expiresAtMs}.${variant}`)}`;
}

/** The variant a valid, unexpired token grants, or null when it doesn't verify. */
export function readWidgetModelToken(
  fileAssetId: string,
  token: string | null | undefined,
  now: number = Date.now()
): WidgetModelVariant | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 2 && parts.length !== 3) return null;
  const expiresAtMs = Number(parts[0]);
  if (!Number.isSafeInteger(expiresAtMs) || expiresAtMs < now) return null;
  try {
    if (parts.length === 2) {
      // Pre-variant token: verify the old payload, grant preview only.
      return constantTimeEqual(parts[1], signature(`${fileAssetId}.${expiresAtMs}`))
        ? "preview"
        : null;
    }
    const variant = parts[1];
    if (variant !== "full" && variant !== "preview") return null;
    return constantTimeEqual(
      parts[2],
      signature(`${fileAssetId}.${expiresAtMs}.${variant}`)
    )
      ? variant
      : null;
  } catch {
    return null;
  }
}

export function verifyWidgetModelToken(
  fileAssetId: string,
  token: string | null | undefined,
  now: number = Date.now()
): boolean {
  return readWidgetModelToken(fileAssetId, token, now) !== null;
}
