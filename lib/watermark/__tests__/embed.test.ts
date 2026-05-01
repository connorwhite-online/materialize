import { describe, it, expect, beforeAll } from "vitest";

beforeAll(() => {
  process.env.WATERMARK_SECRET = "test-secret-do-not-use-in-prod";
});

async function loadModule() {
  return await import("../embed");
}

function makeBinaryStl(triCount: number): Uint8Array {
  const buf = new Uint8Array(84 + triCount * 50);
  const dv = new DataView(buf.buffer);
  // Pre-existing header content — embedStl should overwrite this.
  buf.fill(0x41, 0, 80); // 'A' bytes
  dv.setUint32(80, triCount, true);
  for (let i = 0; i < triCount; i++) {
    const o = 84 + i * 50;
    for (let k = 0; k < 9; k++) {
      dv.setFloat32(o + 12 + k * 4, (i + 1) * (k + 1) * 0.1, true);
    }
  }
  return buf;
}

describe("watermark embed/extract", () => {
  it("roundtrips a token through buildWatermarkToken / verifyWatermarkToken", async () => {
    const { buildWatermarkToken, verifyWatermarkToken, hashId } =
      await loadModule();
    const input = {
      userId: "user_abc",
      purchaseId: "purchase_xyz",
      issuedAt: 1_700_000_000,
    };
    const token = buildWatermarkToken(input);
    expect(token.length).toBe(49);
    const verified = verifyWatermarkToken(token);
    expect(verified).not.toBeNull();
    expect(verified!.issuedAt).toBe(input.issuedAt);
    expect(verified!.userIdHash).toBe(hashId(input.userId));
    expect(verified!.purchaseIdHash).toBe(hashId(input.purchaseId));
  });

  it("rejects a tampered token (flipped MAC byte)", async () => {
    const { buildWatermarkToken, verifyWatermarkToken } = await loadModule();
    const token = buildWatermarkToken({
      userId: "u",
      purchaseId: "p",
      issuedAt: 1,
    });
    const flipped = new Uint8Array(token);
    flipped[40] ^= 0xff;
    expect(verifyWatermarkToken(flipped)).toBeNull();
  });

  it("rejects bytes that aren't a watermark token", async () => {
    const { verifyWatermarkToken } = await loadModule();
    expect(verifyWatermarkToken(new Uint8Array(0))).toBeNull();
    expect(verifyWatermarkToken(new Uint8Array(48))).toBeNull();
    expect(verifyWatermarkToken(new Uint8Array(49))).toBeNull(); // wrong magic
    const wrongMagic = new Uint8Array(49);
    wrongMagic.set([0x41, 0x42, 0x43, 0x44]);
    expect(verifyWatermarkToken(wrongMagic)).toBeNull();
  });

  it("embeds + extracts a watermark in a binary STL header without altering geometry bytes", async () => {
    const { buildWatermarkToken, embedWatermark, extractWatermark, hashId } =
      await loadModule();
    const stl = makeBinaryStl(50);
    const token = buildWatermarkToken({
      userId: "u_42",
      purchaseId: "pur_99",
      issuedAt: 12345,
    });
    const watermarked = embedWatermark(stl, "stl", token);
    expect(watermarked.byteLength).toBe(stl.byteLength);
    // Token written at start of header.
    for (let i = 0; i < 49; i++) {
      expect(watermarked[i]).toBe(token[i]);
    }
    // Header tail (49..80) zeroed.
    for (let i = 49; i < 80; i++) {
      expect(watermarked[i]).toBe(0);
    }
    // Geometry region (>=80) untouched.
    for (let i = 80; i < stl.byteLength; i++) {
      expect(watermarked[i]).toBe(stl[i]);
    }
    const extracted = extractWatermark(watermarked, "stl");
    expect(extracted).not.toBeNull();
    expect(extracted!.userIdHash).toBe(hashId("u_42"));
    expect(extracted!.purchaseIdHash).toBe(hashId("pur_99"));
    expect(extracted!.issuedAt).toBe(12345);
  });

  it("embeds + extracts a watermark as an OBJ comment line", async () => {
    const { buildWatermarkToken, embedWatermark, extractWatermark, hashId } =
      await loadModule();
    const obj = new TextEncoder().encode(
      "v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n"
    );
    const token = buildWatermarkToken({
      userId: "obj_user",
      purchaseId: "obj_purchase",
      issuedAt: 7,
    });
    const watermarked = embedWatermark(obj, "obj", token);
    const text = new TextDecoder().decode(watermarked);
    expect(text.startsWith("# matwm:")).toBe(true);
    // Original OBJ payload still present after the comment.
    expect(text.includes("v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n")).toBe(true);
    const extracted = extractWatermark(watermarked, "obj");
    expect(extracted).not.toBeNull();
    expect(extracted!.userIdHash).toBe(hashId("obj_user"));
    expect(extracted!.purchaseIdHash).toBe(hashId("obj_purchase"));
    expect(extracted!.issuedAt).toBe(7);
  });

  it("returns input bytes unchanged for formats we don't watermark", async () => {
    const { buildWatermarkToken, embedWatermark } = await loadModule();
    const token = buildWatermarkToken({
      userId: "u",
      purchaseId: "p",
      issuedAt: 1,
    });
    const blob = new Uint8Array([1, 2, 3, 4, 5]);
    expect(embedWatermark(blob, "3mf", token)).toEqual(blob);
    expect(embedWatermark(blob, "step", token)).toEqual(blob);
    expect(embedWatermark(blob, "amf", token)).toEqual(blob);
  });

  it("returns null on extract when the bytes aren't watermarked", async () => {
    const { extractWatermark } = await loadModule();
    const stl = makeBinaryStl(3);
    expect(extractWatermark(stl, "stl")).toBeNull();
    const obj = new TextEncoder().encode("v 0 0 0\nf 1 1 1\n");
    expect(extractWatermark(obj, "obj")).toBeNull();
  });
});
