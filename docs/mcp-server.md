# Materialize MCP Server — Design Doc

## 1. Context

Materialize is a 3D-print marketplace with a complete instant-quote-to-fulfillment pipeline (upload → CraftCloud quote → Stripe checkout → CraftCloud order placement on webhook). Today the only client of that pipeline is the human-facing web app. Agents that generate parametric/CAD models are an emerging product category; if "agent designs a part, prints it, ships it to me" becomes a real workflow, Materialize is well-positioned to be the supplier because the catalog/vendor abstraction and fulfillment plumbing already exist.

The wedge: expose the existing print pipeline as an MCP (Model Context Protocol) server so agents can quote, order, and track prints with structured tool calls. Keep human-in-the-loop confirmation in v1 because physical orders are irreversible. Design the auth and status surface so an "agent-budget" mode (Stripe is shipping primitives for this) can be added later without a v2 break.

## 2. Goals

- Expose Materialize's print pipeline as a small, well-shaped MCP tool surface (~10 tools).
- Wrap existing server actions and API routes; do not duplicate business logic.
- Keep all v1 orders gated by explicit human approval via an out-of-band confirmation channel (push / email / web).
- Issue per-user-per-agent OAuth-style tokens with explicit scopes, so an agent cannot accidentally exceed its grant.
- Shape the `create_order` response so future modes (auto-approved within budget, auto-approved with 2FA, etc.) can be added without breaking existing agent integrations.

## 3. Non-goals (v1)

- Unattended purchasing with stored payment methods. (Designed for, not built.)
- Agents creating marketplace listings or selling models. Selling stays human-only for now.
- Streaming progress for prints. Polling is fine; CraftCloud doesn't push status anyway.
- A parallel agent-optimized web surface (separate `/agent` mirror site). The MCP server *is* the agent surface; existing HTML stays as-is, with a small `llms.txt` + JSON-LD pass for discovery (see §10).

## 4. Architecture

```
Agent ─MCP─▶ mcp-server (new)
                  │
                  ├─▶ existing server actions (app/actions/*)
                  │     - createDraftFileForPrint
                  │     - createPrintOrder
                  │     - completePrintOrder
                  │
                  ├─▶ existing API routes
                  │     - /api/craftcloud/quotes  (start)
                  │     - /api/craftcloud/quotes/poll
                  │     - /api/r2/presign
                  │
                  └─▶ shared libs
                        - lib/craftcloud/catalog.ts
                        - lib/db, lib/storage
```

**Hosting.** Run the MCP server as a Next.js route in this same app (e.g. `app/mcp/[...path]/route.ts`) using a streamable-HTTP MCP transport. Same deploy, same env, same auth surface as the web app. Splitting into a separate service buys nothing at this scale and doubles the ops burden.

**Polling shift.** Today the *client* polls `/api/craftcloud/quotes/poll` until quotes stabilize (per AGENTS.md, `allComplete: true` AND count stable for 4 polls). For the MCP path, polling moves *server-side* inside the `get_quote` tool — the tool blocks until the result is stable, then returns once. Agents should not be asked to implement the 4-poll-stable invariant; that's a Materialize-internal correctness concern.

**No anon flow.** All MCP traffic is authenticated. The anon-OTP-at-checkout pattern from `ShippingAddressForm` is a web-only optimization; MCP agents always have a user-tied token, so `ensureModelUploaded`'s draft-mode branch isn't needed here.

## 5. Authentication & scopes

OAuth 2.0 Authorization Code + PKCE flow. The user installs an agent, the agent redirects them to `materialize.com/oauth/authorize?scopes=…&client_id=…`, the user reviews the requested scopes and approves, the agent gets a refresh token + access token tied to that user.

**Scopes (v1):**

| Scope | Grants |
|---|---|
| `catalog:read` | List + read materials, finishes, vendors |
| `files:read` | List the user's uploaded models |
| `files:write` | Upload new models, delete the agent's own uploads |
| `quotes:read` | Run quote calls against the user's files |
| `orders:create` | Initiate an order (still requires user confirmation to actually charge) |
| `orders:read` | Read order status, tracking, history |

**Scopes deferred for future phases:**

| Scope | When |
|---|---|
| `orders:auto_approve` | When agent-budget mode lands (§9) |
| `webhooks:subscribe` | When push status updates land (§9) |

**Implementation note.** Clerk supports OAuth provider mode and machine tokens; either works. Pick one early — retrofitting auth is the most painful refactor in a system like this.

## 6. Tool surface

Ten tools, grouped by purpose. Schemas use TypeScript-ish notation; the actual MCP server would expose JSON Schema.

### 6.1 Catalog

**`list_materials`**
```ts
input: { group?: string; query?: string; limit?: number }
output: {
  materials: Array<{
    id: string            // CraftCloud material UUID
    name: string
    group: string         // e.g. "Standard Plastics"
    featuredImage?: string
    tags: string[]
    finishes: Array<{ id: string; name: string }>
  }>
  nextCursor?: string
}
```
Backed by `lib/craftcloud/catalog.ts` (already 24h-cached). Cheap, no auth required at the tool level beyond `catalog:read`.

**`get_material`**
```ts
input: { id: string }   // CraftCloud material id
output: {
  id, name, group, description, featuredImage?,
  properties: { tensileStrengthMpa?, density?, heatDeflectionC?, … }
  buildVolumeMm: [number, number, number] | null
  finishes: Array<{ id, name, description?, vendors: string[], colors: string[] }>
}
```

### 6.2 Files

**`request_upload_url`** (for files larger than ~5MB)
```ts
input: { filename: string; sizeBytes: number; contentType: string }
output: { uploadUrl: string; key: string; expiresAt: string }
```
Returns a presigned R2 PUT URL. Agent PUTs the file directly, then calls `register_upload`.

**`register_upload`**
```ts
input: { key: string }           // from request_upload_url
output: {
  fileId: string
  dimensions: { x: number; y: number; z: number; unit: "mm" }
  volumeMm3: number
  warnings: string[]              // e.g. "model has non-manifold geometry"
}
```

**`upload_model`** (convenience wrapper for small files)
```ts
input: { source: { url: string } | { base64: string; filename: string } }
output: { fileId, dimensions, volumeMm3, warnings }
```
Internally does presign → PUT → register in one shot. Caps at ~10 MB; bigger files must use the two-step flow.

**`list_files`**
```ts
input: { since?: string }
output: { files: Array<{ id, filename, sizeBytes, dimensions, uploadedAt }> }
```

**`delete_file`**
```ts
input: { fileId: string }
output: { deleted: true }
```
Only the user (or agents with `files:write`) can delete. Cannot delete files referenced by an active order.

### 6.3 Quotes

**`get_quote`**
```ts
input: {
  fileId: string
  materialId: string         // CraftCloud material UUID
  finishId?: string          // narrows the result; omit for all finishes
  shipTo?: { country: string; postalCode?: string }  // affects shipping
}
output: {
  quotes: Array<{
    priceId: string          // opaque, pass to create_order
    vendorId: string
    vendorName: string
    finishId: string
    finishName: string
    color: string
    priceCents: number
    currency: "USD"
    leadTimeBusinessDays: number
    expiresAt: string        // priceId TTL
  }>
  warnings: string[]
}
```
Server-side polls `/api/craftcloud/quotes/poll` until stable per the existing invariant, then returns. Tool is allowed up to ~30s of internal polling — set timeout accordingly. If CraftCloud is genuinely slow, fail with a retryable error rather than hanging.

### 6.4 Orders

**`create_order`**
```ts
input: {
  priceId: string
  shippingAddress: {
    name: string
    line1: string
    line2?: string
    city: string
    region: string
    postalCode: string
    country: string  // ISO 3166-1 alpha-2
    phone?: string
  }
  idempotencyKey: string  // required; agent-supplied
  notify?: { pushChannel?: "default"; email?: string }  // override notification routing
}
output: {
  orderId: string
  status: "awaiting_user_approval"
  confirmationUrl: string   // user-facing URL the agent can surface or open
  notificationsSent: { push: boolean; email: boolean }
  expiresAt: string         // approval window
}
```

The `status` field is an **open enum** by design. Today only `awaiting_user_approval` ships; future values: `auto_approved_within_budget`, `auto_approved_with_2fa`, `cancelled_by_user`, `expired`. Agents must treat unknown statuses as terminal-or-pending based on a `terminal: boolean` companion field (see error model in §7).

When the user approves out-of-band, the existing Stripe webhook chain (`/api/webhooks/stripe`) → `completePrintOrder` → CraftCloud cart placement runs unchanged. The MCP server is not in that critical path.

**`get_order`**
```ts
input: { orderId: string }
output: {
  orderId
  status: "awaiting_user_approval" | "paid" | "in_production" | "shipped"
        | "delivered" | "cancelled" | "expired" | "failed"
  terminal: boolean
  vendor: { id, name }
  material: { id, name, finish, color }
  priceCents, currency
  estimatedDelivery?: string
  tracking?: { carrier: string; number: string; url?: string }
  cancelReason?: string
}
```

**`list_orders`**
```ts
input: { since?: string; status?: OrderStatus[]; limit?: number }
output: { orders: Array<GetOrderOutput>; nextCursor?: string }
```

## 7. Confirmation flow

```
agent ─create_order──▶ MCP server
                            │
                            ├─ creates draft printOrders row (status: awaiting_user_approval)
                            ├─ enqueues Stripe Checkout session URL
                            ├─ sends push to user's devices (if registered)
                            ├─ sends email with confirmation URL (always, as fallback)
                            └─ returns { confirmationUrl, expiresAt } to agent
                                  │
user opens confirmationUrl on phone / desktop
   ├─ reviews material, vendor, price, lead time, shipping address
   ├─ taps "Confirm and pay" → Stripe Checkout (existing flow)
   └─ on payment success: webhook → CraftCloud cart placed (existing flow)

agent polls get_order until terminal
```

**Channel rules.**
- Push when the user has registered a device (web push or app push). Optional in v1 — start with email-only and add push later.
- Email always, as the durable fallback. The email contains the same confirmationUrl.
- Never SMS in v1 (Twilio overhead, regulatory friction).

**Expiry.** A confirmationUrl is valid for the lesser of (a) the priceId TTL from CraftCloud (typically 24h) and (b) 24h. After that, `get_order` returns `status: "expired"` and the agent must re-quote and re-create.

**Idempotency.** `idempotencyKey` is required. Same key + same input within 24h returns the original `orderId`. Same key + *different* input is an error (`idempotency_key_reuse`). This is the standard Stripe pattern.

## 8. Errors

MCP tools return errors as a structured object so agents can react programmatically:

```ts
{
  error: {
    code: "rate_limited" | "invalid_scope" | "file_too_large"
        | "quote_timed_out" | "price_expired" | "address_invalid"
        | "idempotency_key_reuse" | "order_not_owned" | "internal"
    message: string                  // human-readable, may change
    retryable: boolean
    retryAfterMs?: number             // when retryable
    details?: Record<string, unknown>
  }
}
```

`code` is the stable contract; `message` is for logs and UIs. New error codes can be added; agents must handle unknown codes by surfacing the message and treating `retryable` as authoritative.

## 9. Future affordances (designed for, not built)

These don't ship in v1, but the v1 surface is shaped to admit them:

1. **Agent-budget mode.** A user grants an agent `orders:auto_approve` plus a budget (`{ monthlyCents: 5000, perOrderCents: 2000 }`). `create_order` then returns `status: "auto_approved_within_budget"` directly, no human confirmation, charge runs immediately. Out-of-budget orders fall back to the v1 confirmation flow. Stripe is rolling out primitives that make this practical (delegated checkout, agent payment tokens).

2. **Webhooks for status changes.** Agents that don't want to poll can subscribe to `order.status_changed` webhooks scoped to their token. Adds a `webhooks:subscribe` scope.

3. **Quote refinement.** A `compare_quotes` tool that takes a fileId + a list of candidate materials and returns the cheapest / fastest / closest-to-spec. Pure server-side reasoning over `get_quote` results.

4. **Resources, not just tools.** MCP supports static resources; the catalog could be exposed as a subscribable resource (`materials://`) so agents get cache invalidation for free when CraftCloud's 24h cache rolls.

## 10. Companion: agent-discovery work

Small, separable, ships independently.

### 10.1 `llms.txt` and `llms-full.txt`

Add `app/llms.txt/route.ts` and `app/llms-full.txt/route.ts` (or static files in `public/`). Standard format ([llmstxt.org](https://llmstxt.org)):

```
# Materialize

> 3D-print marketplace and instant-quote service. Upload a model, pick a
> material, get printed by a vetted vendor, shipped to your door.

## Tools for agents

- [MCP server](https://materialize.com/mcp): full programmatic access
  for agents to quote, order, and track prints. See
  https://materialize.com/docs/mcp.

## Catalog

- [Materials index](https://materialize.com/materials)
- [Per-material detail](https://materialize.com/materials/[slug])

## Pricing

- 3% service fee on print orders. Materials and shipping are vendor-priced.
```

`llms-full.txt` includes the same plus a flat-text dump of the catalog and a brief explanation of the print pipeline. Both regenerate on deploy.

### 10.2 JSON-LD on catalog pages

Add `<script type="application/ld+json">` blocks to `/materials` and `/materials/[slug]` with `Product` schema (name, description, image, offers, properties). Cheap, helps Google + agent crawlers parse the catalog as structured data. No design or layout changes needed.

### 10.3 Skip

A parallel `/agent` site mirror, custom robots.txt rules for agents, separate "agent rendering" of the print flow. The MCP server replaces the case for these.

## 11. Open questions

To resolve before Phase 1 kicks off:

- **Push infra.** Web push (VAPID) is free but requires service-worker work. Email-only at v1 may be enough. Decide scope.
- **OAuth provider.** Clerk OAuth provider vs. building a thin layer over Clerk machine tokens. Clerk's OAuth provider is newer; investigate maturity.
- **File format support.** STL, STEP, OBJ are the obvious ones. 3MF? AMF? GLTF? Default to whatever CraftCloud accepts and reject the rest.
- **Tool naming.** Should it be `materialize_create_order` (namespaced) or `create_order`? MCP spec leans unprefixed but agents installing many MCPs benefit from prefixing. Probably prefix.
- **Quote freshness.** Should `get_quote` return a `maxAge` so agents can cache? Or always force a fresh quote? CraftCloud quotes change rarely but vendors can go offline.

## 12. Implementation phases

Each phase is one PR or a small stack. None of these execute under this doc — they'd each be a separate plan.

**Phase 0 — design doc lands.** This file.

**Phase 1 — read-only MCP.** `list_materials`, `get_material`, `list_orders`, `get_order`, `list_files`. No mutations, no auth complexity beyond OAuth scaffolding. Ships behind a feature flag.

**Phase 2 — file upload + quotes.** `request_upload_url`, `register_upload`, `upload_model`, `delete_file`, `get_quote`. Move polling server-side. Add `quotes:read` and `files:write` scopes.

**Phase 3 — order creation + confirmation flow.** `create_order`. Wire email confirmation channel. Add the user-facing confirmation page (reuses existing checkout UX). Add `orders:create` scope. End-to-end test: agent quote → create_order → user clicks email link → Stripe checkout → CraftCloud order.

**Phase 4 — discovery surface.** `llms.txt`, `llms-full.txt`, JSON-LD on catalog pages.

**Phase 5 — push notifications.** Web push for confirmation. Optional.

**Phase 6 — webhooks for agents.** `order.status_changed` subscriptions. `webhooks:subscribe` scope.

**Phase 7 — agent-budget mode.** `orders:auto_approve` scope, budget settings UI, the `auto_approved_within_budget` status path. Depends on Stripe agent-payment primitives being production-ready.

## 13. Verification

Per phase:
- Phase 1: hit the MCP server with the official MCP inspector + a simple test agent (Claude Desktop with the server installed). Verify tool listings, scopes enforced, read-only.
- Phase 2: upload a known-good STL, get_quote on PLA White, confirm priceIds match what `/api/craftcloud/quotes/poll` returns to the web client for the same file.
- Phase 3: full agent-driven order in a Stripe test environment. Confirmation email received, click-through completes Stripe test checkout, CraftCloud sandbox order created.
- Phase 4: validate `llms.txt` against llmstxt.org parsers; run JSON-LD through Google's Rich Results test.

End-to-end smoke test for the whole stack: Claude Desktop with the Materialize MCP installed → "print me a 30mm calibration cube in PLA" → agent uploads the model, quotes, creates order, surfaces email link → user approves → Stripe test charge → CraftCloud sandbox order.
