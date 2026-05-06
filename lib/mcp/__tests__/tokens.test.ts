import { describe, it, expect } from "vitest";
import {
  generateToken,
  hashToken,
  looksLikeMaterializeToken,
} from "../tokens";

describe("generateToken", () => {
  it("returns a token with the mtl_pat_ prefix", () => {
    const t = generateToken();
    expect(t.raw.startsWith("mtl_pat_")).toBe(true);
  });

  it("returns enough entropy that two consecutive tokens never collide", () => {
    const a = generateToken();
    const b = generateToken();
    expect(a.raw).not.toBe(b.raw);
    expect(a.hash).not.toBe(b.hash);
  });

  it("returns a deterministic hash for the same raw token", () => {
    const t = generateToken();
    expect(hashToken(t.raw)).toBe(t.hash);
  });

  it("returns a prefix that is a strict prefix of the raw token", () => {
    const t = generateToken();
    expect(t.raw.startsWith(t.prefix)).toBe(true);
    expect(t.prefix.length).toBeGreaterThan("mtl_pat_".length);
    expect(t.prefix.length).toBeLessThan(t.raw.length);
  });
});

describe("hashToken", () => {
  it("returns a 64-character hex string (SHA-256)", () => {
    const h = hashToken("anything");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it("differs across inputs", () => {
    expect(hashToken("a")).not.toBe(hashToken("b"));
  });
});

describe("looksLikeMaterializeToken", () => {
  it("accepts a real generated token", () => {
    const t = generateToken();
    expect(looksLikeMaterializeToken(t.raw)).toBe(true);
  });

  it("rejects empty / wrong-prefix / too-short inputs", () => {
    expect(looksLikeMaterializeToken("")).toBe(false);
    expect(looksLikeMaterializeToken("not-a-token")).toBe(false);
    expect(looksLikeMaterializeToken("mtl_pat_short")).toBe(false);
    expect(looksLikeMaterializeToken("Bearer mtl_pat_xxxxxxxxxxxxxxxx")).toBe(
      false
    );
  });
});
