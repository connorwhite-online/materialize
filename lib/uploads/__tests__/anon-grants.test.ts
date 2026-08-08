import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Guards on the unauthenticated-upload surface (anon print flow).
 *
 * This is the one place in the app where a caller with no session can
 * cause a write into our R2 bucket, so the properties asserted here
 * are load-bearing, not incidental:
 *   - the limiter fails CLOSED (it IS the gate, unlike the CAD
 *     throttle which sits behind auth and fails open),
 *   - IPs are hashed with a salt, never stored raw,
 *   - a grant is single-use and expires,
 *   - a key we never issued is refused.
 */

const selectWhereMock = vi.fn();
const updateWhereMock = vi.fn();

vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({
      from: () => ({ where: (...a: unknown[]) => selectWhereMock(...a) }),
    }),
    update: () => ({
      set: () => ({
        where: () => ({
          returning: (...a: unknown[]) => updateWhereMock(...a),
        }),
      }),
    }),
  },
}));

vi.mock("@/lib/db/schema", () => ({
  anonUploadGrants: {
    ipHash: "ip_hash",
    storageKey: "storage_key",
    createdAt: "created_at",
    consumedAt: "consumed_at",
    originalFilename: "original_filename",
    id: "id",
  },
}));

import {
  ANON_UPLOAD_PREFIX,
  checkAnonUploadLimit,
  clientIpFrom,
  consumeAnonUploadGrant,
  hashIp,
  resolveAnonUploadLimitConfig,
} from "../anon-grants";

const NOW = 1_786_000_000_000;
const CONFIG = { limit: 3, windowMs: 60_000 };

describe("resolveAnonUploadLimitConfig", () => {
  it("uses defaults when unset", () => {
    expect(resolveAnonUploadLimitConfig({})).toEqual({
      limit: 20,
      windowMs: 60 * 60_000,
    });
  });

  it("reads overrides from env", () => {
    expect(
      resolveAnonUploadLimitConfig({
        ANON_UPLOAD_MAX_PER_WINDOW: "5",
        ANON_UPLOAD_WINDOW_MINUTES: "2",
      })
    ).toEqual({ limit: 5, windowMs: 120_000 });
  });

  // A typo must not silently remove the cap on an unauthenticated
  // endpoint — every bad value falls back rather than disabling it.
  it.each([["0"], ["-1"], ["abc"], [""]])(
    "falls back rather than disabling the cap for %s",
    (raw) => {
      expect(
        resolveAnonUploadLimitConfig({ ANON_UPLOAD_MAX_PER_WINDOW: raw }).limit
      ).toBe(20);
    }
  );
});

describe("hashIp", () => {
  it("is stable, salted, and never echoes the address", () => {
    const env = { ANON_UPLOAD_IP_SALT: "s1" };
    const a = hashIp("203.0.113.7", env);

    expect(a).toBe(hashIp("203.0.113.7", env));
    expect(a).not.toContain("203.0.113.7");
    expect(a).toMatch(/^[a-f0-9]{64}$/);
    // A different salt yields a different digest, so a leaked hash
    // can't be brute-forced against the (tiny) IPv4 space elsewhere.
    expect(a).not.toBe(hashIp("203.0.113.7", { ANON_UPLOAD_IP_SALT: "s2" }));
  });

  it("separates different addresses", () => {
    const env = { ANON_UPLOAD_IP_SALT: "s1" };
    expect(hashIp("203.0.113.7", env)).not.toBe(hashIp("203.0.113.8", env));
  });
});

describe("clientIpFrom", () => {
  it("takes the left-most x-forwarded-for entry", () => {
    const h = new Headers({
      "x-forwarded-for": "203.0.113.7, 70.41.3.18, 150.172.238.178",
    });
    expect(clientIpFrom(h)).toBe("203.0.113.7");
  });

  it("falls back to x-real-ip", () => {
    expect(clientIpFrom(new Headers({ "x-real-ip": "203.0.113.9" }))).toBe(
      "203.0.113.9"
    );
  });

  // The caller turns null into a refusal: an unauthenticated write we
  // can't attribute is exactly what the cap exists to stop, so
  // stripping the header must not be a way around it.
  it("returns null when no address header is present", () => {
    expect(clientIpFrom(new Headers())).toBeNull();
  });
});

describe("checkAnonUploadLimit", () => {
  beforeEach(() => vi.clearAllMocks());

  it("allows while under the cap", async () => {
    selectWhereMock.mockResolvedValue([{ count: 2, oldest: null }]);
    expect(await checkAnonUploadLimit("h", NOW, CONFIG)).toEqual({ ok: true });
  });

  it("refuses at the cap with a retry-after from the oldest row", async () => {
    const oldest = new Date(NOW - 20_000).toISOString();
    selectWhereMock.mockResolvedValue([{ count: 3, oldest }]);

    expect(await checkAnonUploadLimit("h", NOW, CONFIG)).toEqual({
      ok: false,
      retryAfterSeconds: 40,
    });
  });

  // The distinguishing property vs the CAD throttle, which fails open
  // because auth already gated it. Here the limiter IS the gate.
  it("fails CLOSED when the database errors", async () => {
    selectWhereMock.mockRejectedValue(new Error("db down"));

    expect(await checkAnonUploadLimit("h", NOW, CONFIG)).toEqual({
      ok: false,
      retryAfterSeconds: 60,
    });
  });
});

describe("consumeAnonUploadGrant", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns the grant and marks it consumed", async () => {
    updateWhereMock.mockResolvedValue([{ originalFilename: "part.stl" }]);

    expect(await consumeAnonUploadGrant(`${ANON_UPLOAD_PREFIX}abc/part.stl`)).toEqual(
      { originalFilename: "part.stl" }
    );
  });

  // Consumed / expired / never-issued all collapse to the same null,
  // so an attacker learns nothing about which keys exist.
  it("returns null when the conditional update matches nothing", async () => {
    updateWhereMock.mockResolvedValue([]);
    expect(await consumeAnonUploadGrant("anon-uploads/nope/x.stl")).toBeNull();
  });
});
