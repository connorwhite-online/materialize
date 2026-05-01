import "server-only";

import { createHmac, createHash, timingSafeEqual } from "crypto";
import { requireEnv } from "@/lib/env";

// Watermark format — fixed 49-byte binary blob:
//
//   [0..4)   magic       'MWM1' (0x4D 0x57 0x4D 0x31)
//   [4..5)   version     0x01
//   [5..9)   timestamp   uint32 BE, unix seconds
//   [9..21)  userHash    first 12 bytes of SHA-256(userId)
//   [21..33) purchaseHash first 12 bytes of SHA-256(purchaseId)
//   [33..49) mac         HMAC-SHA256(secret, [0..33))[0..16]
//
// We hash the raw IDs rather than embedding them so the whole token
// fits in an STL's 80-byte header. To trace a leaked file: extract
// the watermark, then scan candidate users / purchases for a SHA-256
// prefix match. With a userbase under ~1B and a purchase set under
// ~1B, 96-bit prefixes give effectively zero collisions.
//
// Embedded into:
//   - STL binary: bytes 0..49 of the 80-byte file header (rest zeroed).
//   - OBJ ASCII : `# matwm:<base64url(token)>\n` prepended.
//
// Verification re-derives the HMAC; tamper or partial copy fails.

const MAGIC = Uint8Array.of(0x4d, 0x57, 0x4d, 0x31); // 'MWM1'
const VERSION = 0x01;
const TOKEN_BYTES = 49;
const STL_HEADER_BYTES = 80;
const OBJ_PREFIX = "# matwm:";
const SECRET_ENV = "WATERMARK_SECRET";

export type WatermarkInput = {
  userId: string;
  purchaseId: string;
  issuedAt: number; // unix seconds
};

export type WatermarkPayload = {
  userIdHash: string;     // 24-char hex (12 bytes)
  purchaseIdHash: string; // 24-char hex (12 bytes)
  issuedAt: number;
};

function getSecret(): string {
  return requireEnv(SECRET_ENV);
}

function b64urlEncode(buf: Uint8Array): string {
  return Buffer.from(buf)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function b64urlDecode(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? 0 : 4 - (s.length % 4);
  const padded = s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat(pad);
  return new Uint8Array(Buffer.from(padded, "base64"));
}

function shortHash(input: string, bytes: number): Uint8Array {
  return new Uint8Array(
    createHash("sha256").update(input).digest().subarray(0, bytes)
  );
}

function toHex(buf: Uint8Array): string {
  return Buffer.from(buf).toString("hex");
}

export function buildWatermarkToken(input: WatermarkInput): Uint8Array {
  if (input.issuedAt < 0 || input.issuedAt > 0xffffffff) {
    throw new Error("issuedAt out of uint32 range");
  }
  const token = new Uint8Array(TOKEN_BYTES);
  token.set(MAGIC, 0);
  token[4] = VERSION;
  const dv = new DataView(token.buffer, token.byteOffset, token.byteLength);
  dv.setUint32(5, input.issuedAt >>> 0, false); // big-endian
  token.set(shortHash(input.userId, 12), 9);
  token.set(shortHash(input.purchaseId, 12), 21);
  const mac = createHmac("sha256", getSecret())
    .update(token.subarray(0, 33))
    .digest()
    .subarray(0, 16);
  token.set(mac, 33);
  return token;
}

export function verifyWatermarkToken(
  token: Uint8Array
): WatermarkPayload | null {
  if (token.length !== TOKEN_BYTES) return null;
  for (let i = 0; i < MAGIC.length; i++) {
    if (token[i] !== MAGIC[i]) return null;
  }
  if (token[4] !== VERSION) return null;
  const expected = createHmac("sha256", getSecret())
    .update(token.subarray(0, 33))
    .digest()
    .subarray(0, 16);
  const candidate = token.subarray(33, 49);
  if (!timingSafeEqual(expected, candidate)) return null;
  const dv = new DataView(token.buffer, token.byteOffset, token.byteLength);
  return {
    issuedAt: dv.getUint32(5, false),
    userIdHash: toHex(token.subarray(9, 21)),
    purchaseIdHash: toHex(token.subarray(21, 33)),
  };
}

// Small helper for callers that want the hash form of a known-good
// id (for matching back from a verified token).
export function hashId(id: string): string {
  return toHex(shortHash(id, 12));
}

// Embed a watermark into the format-appropriate metadata region of a
// 3D file. Returns the bytes to serve. Geometry data is never touched
// — if there's no safe place for the token in this format, we return
// the input bytes unchanged.

export function embedWatermark(
  bytes: Uint8Array,
  format: "stl" | "obj" | "3mf" | "step" | "amf",
  token: Uint8Array
): Uint8Array {
  if (token.length !== TOKEN_BYTES) return bytes;
  if (format === "stl") return embedStl(bytes, token);
  if (format === "obj") return embedObj(bytes, token);
  // 3MF/STEP/AMF — leave alone for v1. The byte path through the
  // download stays correct; we just don't get tracing on these
  // formats yet.
  return bytes;
}

function embedStl(bytes: Uint8Array, token: Uint8Array): Uint8Array {
  if (bytes.length >= 84) {
    const dv = new DataView(
      bytes.buffer,
      bytes.byteOffset,
      bytes.byteLength
    );
    const triCount = dv.getUint32(80, true);
    if (84 + triCount * 50 === bytes.length) {
      return embedStlBinaryHeader(bytes, token);
    }
  }
  // ASCII STL has no comment syntax — refuse to touch geometry.
  return bytes;
}

function embedStlBinaryHeader(
  bytes: Uint8Array,
  token: Uint8Array
): Uint8Array {
  const out = new Uint8Array(bytes.length);
  out.set(bytes);
  out.fill(0, 0, STL_HEADER_BYTES);
  out.set(token, 0);
  return out;
}

function embedObj(bytes: Uint8Array, token: Uint8Array): Uint8Array {
  const header = Buffer.from(`${OBJ_PREFIX}${b64urlEncode(token)}\n`, "utf8");
  const out = new Uint8Array(header.byteLength + bytes.byteLength);
  out.set(header, 0);
  out.set(bytes, header.byteLength);
  return out;
}

// Recover a watermark token from a previously-watermarked file. Used
// when a leaked file shows up and we want to trace the buyer. Returns
// the verified payload (with hashed ids) or null.

export function extractWatermark(
  bytes: Uint8Array,
  format: "stl" | "obj" | "3mf" | "step" | "amf"
): WatermarkPayload | null {
  if (format === "stl") {
    if (bytes.length < TOKEN_BYTES) return null;
    return verifyWatermarkToken(bytes.subarray(0, TOKEN_BYTES));
  }
  if (format === "obj") {
    const text = new TextDecoder().decode(bytes.subarray(0, 4096));
    const m = text.match(/^# matwm:([A-Za-z0-9_-]+)/m);
    if (!m) return null;
    const decoded = b64urlDecode(m[1]);
    return verifyWatermarkToken(decoded);
  }
  return null;
}
