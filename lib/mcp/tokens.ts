import { createHash, randomBytes } from "node:crypto";

const TOKEN_PREFIX = "mtl_pat_";
const RAW_RANDOM_BYTES = 32;

export interface GeneratedToken {
  raw: string;
  hash: string;
  prefix: string;
}

export function generateToken(): GeneratedToken {
  const random = randomBytes(RAW_RANDOM_BYTES).toString("base64url");
  const raw = `${TOKEN_PREFIX}${random}`;
  return {
    raw,
    hash: hashToken(raw),
    prefix: raw.slice(0, TOKEN_PREFIX.length + 8),
  };
}

export function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

export function looksLikeMaterializeToken(raw: string): boolean {
  return raw.startsWith(TOKEN_PREFIX) && raw.length > TOKEN_PREFIX.length + 16;
}
