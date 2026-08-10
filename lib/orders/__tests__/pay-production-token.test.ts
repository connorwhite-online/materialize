import { describe, it, expect, beforeEach, afterEach } from "vitest";

import {
  mintPayProductionToken,
  verifyPayProductionToken,
} from "../pay-production-token";

// The token is the only thing standing between "anyone with a URL
// guess" and a session-less page that names order totals — so the
// negative cases (tamper, cross-order reuse, expiry, missing secret)
// matter more than the happy path.

const ORDER = "order-abc-123";
const NOW = 1_754_000_000_000;

const originalKey = process.env.STRIPE_SECRET_KEY;

describe("pay-production link tokens", () => {
  beforeEach(() => {
    process.env.STRIPE_SECRET_KEY = "sk_test_signing_key";
  });

  afterEach(() => {
    if (originalKey === undefined) delete process.env.STRIPE_SECRET_KEY;
    else process.env.STRIPE_SECRET_KEY = originalKey;
  });

  it("round-trips: a freshly minted token verifies for its order", () => {
    const token = mintPayProductionToken(ORDER, NOW);
    expect(verifyPayProductionToken(ORDER, token, NOW)).toBe(true);
  });

  it("stays valid just under 24h and expires at the boundary", () => {
    const token = mintPayProductionToken(ORDER, NOW);
    const almost24h = NOW + 24 * 60 * 60 * 1000 - 1;
    const past24h = NOW + 24 * 60 * 60 * 1000 + 1;
    expect(verifyPayProductionToken(ORDER, token, almost24h)).toBe(true);
    expect(verifyPayProductionToken(ORDER, token, past24h)).toBe(false);
  });

  it("a token minted for one order is useless on another order's URL", () => {
    const token = mintPayProductionToken(ORDER, NOW);
    expect(verifyPayProductionToken("order-other", token, NOW)).toBe(false);
  });

  it("rejects a tampered expiry (extending the deadline breaks the signature)", () => {
    const token = mintPayProductionToken(ORDER, NOW);
    const [, sig] = token.split(".");
    const extended = `${NOW + 48 * 60 * 60 * 1000}.${sig}`;
    expect(verifyPayProductionToken(ORDER, extended, NOW)).toBe(false);
  });

  it("rejects a tampered signature", () => {
    const token = mintPayProductionToken(ORDER, NOW);
    const flipped = token.slice(0, -1) + (token.endsWith("A") ? "B" : "A");
    expect(verifyPayProductionToken(ORDER, flipped, NOW)).toBe(false);
  });

  it.each([
    [undefined],
    [""],
    ["garbage"],
    ["."],
    [".sigonly"],
    ["notanumber.sig"],
    ["12345"],
  ])("rejects malformed token %j", (bad) => {
    expect(verifyPayProductionToken(ORDER, bad as string | undefined, NOW)).toBe(
      false
    );
  });

  it("verification fails closed (no throw) when STRIPE_SECRET_KEY is unset", () => {
    const token = mintPayProductionToken(ORDER, NOW);
    delete process.env.STRIPE_SECRET_KEY;
    expect(verifyPayProductionToken(ORDER, token, NOW)).toBe(false);
  });

  it("minting without STRIPE_SECRET_KEY throws loudly (misconfigured env must not mint dead links)", () => {
    delete process.env.STRIPE_SECRET_KEY;
    expect(() => mintPayProductionToken(ORDER, NOW)).toThrow(
      /STRIPE_SECRET_KEY/
    );
  });

  it("tokens are URL-safe as-is (no characters needing percent-encoding)", () => {
    const token = mintPayProductionToken(ORDER, NOW);
    expect(encodeURIComponent(token)).toBe(token);
  });
});
