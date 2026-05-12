export const ALL_SCOPES = [
  "catalog:read",
  "files:read",
  "files:write",
  "projects:read",
  "projects:write",
  "quotes:read",
  "orders:create",
  "orders:read",
] as const;

export type Scope = (typeof ALL_SCOPES)[number];

export const SCOPE_DESCRIPTIONS: Record<Scope, string> = {
  "catalog:read": "Browse the material catalog (read-only)",
  "files:read": "List your uploaded models",
  "files:write":
    "Upload new models, edit listing metadata + cover photo, attach curator photos, and delete its own uploads",
  "projects:read": "List and read your projects (BOM, wiring, photos)",
  "projects:write":
    "Create and edit projects — bundle files, set BOM line items, attach wiring diagrams (image / KiCad / Wokwi), link the firmware repo, and manage project photos",
  "quotes:read": "Get prices for prints against your files",
  "orders:create":
    "Create draft orders on your behalf — you still confirm and pay for each one",
  "orders:read": "Read order status, tracking, and history",
};

export function isValidScope(s: string): s is Scope {
  return (ALL_SCOPES as readonly string[]).includes(s);
}
