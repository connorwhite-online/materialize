export const ALL_SCOPES = [
  "catalog:read",
  "files:read",
  "files:write",
  "quotes:read",
  "orders:create",
  "orders:read",
] as const;

export type Scope = (typeof ALL_SCOPES)[number];

export const SCOPE_DESCRIPTIONS: Record<Scope, string> = {
  "catalog:read": "Browse the material catalog (read-only)",
  "files:read": "List your uploaded models",
  "files:write": "Upload new models and delete its own uploads",
  "quotes:read": "Get prices for prints against your files",
  "orders:create":
    "Create draft orders on your behalf — you still confirm and pay for each one",
  "orders:read": "Read order status, tracking, and history",
};

export function isValidScope(s: string): s is Scope {
  return (ALL_SCOPES as readonly string[]).includes(s);
}
