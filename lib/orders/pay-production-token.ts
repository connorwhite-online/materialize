import "server-only";

import { createHash, createHmac } from "node:crypto";
import { constantTimeEqual } from "@/lib/auth/constant-time-equal";

/**
 * Signed, short-lived link tokens for the two-step pay-production
 * interstitial (`/orders/[id]/pay-production`).
 *
 * Why: the fee Checkout's success_url must load in browser contexts
 * that have NO Clerk session. On iOS, checkout launched from the
 * home-screen PWA opens in an in-app browser overlay with an isolated
 * cookie jar, so the post-payment redirect always lands signed-out —
 * `auth.protect()` there kicks off Clerk's redirect handshake, which
 * dies inside the cookie-isolated webview ("This page couldn't load").
 * The token lets the page prove "this visitor came from this order's
 * own checkout link" without a session.
 *
 * What a token does NOT prove: that the fee was paid. It is minted
 * when the Checkout session is created, i.e. before payment — anyone
 * holding the success URL could open it early. The page therefore
 * still branches on the ORDER STATUS for anything payment-dependent
 * and shows tokened visitors a waiting state until the webhook
 * advances the row.
 *
 * Key derivation: HMAC-SHA256 keyed off a hash of STRIPE_SECRET_KEY
 * rather than a new env var — the secret already exists in every
 * environment that can mint a Stripe session, is high-entropy, and
 * is server-only. Rotating the Stripe key invalidates outstanding
 * links, which is fine: they expire in 24h anyway (matching the
 * Stripe Checkout session lifetime).
 *
 * Format: `<expiresAtMs>.<base64url hmac of "<orderId>.<expiresAtMs>">`.
 * The orderId is bound into the signature but not repeated in the
 * token — the page always verifies against the orderId from its own
 * route params, so a token for order A is useless on order B's URL.
 */

const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

const KEY_CONTEXT = "materialize:pay-production-token:v1";

function signingKey(): Buffer {
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) {
    throw new Error(
      "pay-production-token: STRIPE_SECRET_KEY is not set — cannot derive signing key"
    );
  }
  return createHash("sha256").update(`${KEY_CONTEXT}:${stripeKey}`).digest();
}

function signature(orderId: string, expiresAtMs: number): string {
  return createHmac("sha256", signingKey())
    .update(`${orderId}.${expiresAtMs}`)
    .digest("base64url");
}

export function mintPayProductionToken(
  orderId: string,
  now: number = Date.now()
): string {
  const expiresAtMs = now + TOKEN_TTL_MS;
  return `${expiresAtMs}.${signature(orderId, expiresAtMs)}`;
}

export function verifyPayProductionToken(
  orderId: string,
  token: string | undefined,
  now: number = Date.now()
): boolean {
  if (!token) return false;

  const dot = token.indexOf(".");
  if (dot <= 0) return false;

  const expiresAtMs = Number(token.slice(0, dot));
  if (!Number.isSafeInteger(expiresAtMs) || expiresAtMs < now) return false;

  // Verification must never 500 the page — a missing STRIPE_SECRET_KEY
  // (misconfigured env) just means no tokened access.
  try {
    return constantTimeEqual(
      token.slice(dot + 1),
      signature(orderId, expiresAtMs)
    );
  } catch {
    return false;
  }
}
