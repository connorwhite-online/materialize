---
name: materialize
description: Order real, professionally manufactured 3D prints of STL/STEP/OBJ/3MF/AMF models through Materialize (materialize.cc) — instant quotes across industrial processes (FDM, SLS, MJF, resins, metals) from vetted vendors, shipped to the user's door. Use when the user wants a physical part manufactured — the fulfillment step after CAD generation. Uploads, quotes, and orders run over the Materialize MCP server; every order is approved by the human via their existing confirmation flow before money moves.
---

# Materialize

Materialize is a 3D-print marketplace and instant-quote service. You (the agent) upload a model, fetch competing quotes across materials and vendors, present options to the user, and create an order. The user — never you — approves and pays. Production and shipping are priced by the vendor network (via CraftCloud) and pass through unchanged; Materialize adds a 3% service fee on the pre-shipping subtotal.

Use this skill as the terminal node of a CAD workflow: once a validated STEP/STL exists (e.g. from `$cad`), this is how it becomes a physical part when the user has no printer, needs an industrial process (SLS/MJF/metal), or wants it shipped.

## Connect

Materialize exposes an MCP server over streamable HTTP:

- **Endpoint**: `<origin>/api/mcp`, where `<origin>` is the Materialize instance the user's account lives on — `https://materialize.cc/api/mcp` for the hosted service. Never assume `localhost`; if the user runs a private instance, ask for its origin.
- **Auth**: `Authorization: Bearer <personal-access-token>`. The user mints the token at `<origin>/dashboard/settings/tokens` (that page also displays the exact endpoint URL). Tokens are scoped; this workflow needs `catalog:read`, `files:read`, `files:write`, `quotes:read`, `orders:create`, `orders:read`.
- Example (Claude Code): `claude mcp add --transport http materialize https://materialize.cc/api/mcp --header "Authorization: Bearer <token>"`.

Every tool returns a single JSON text block; errors carry `{ "error": { code, message, retryable } }`. An `invalid_scope` error means the token lacks a scope — the user must mint a broader token; you cannot fix this yourself.

## Defaults

Proceed with these unless the user says otherwise, and state every assumption you used:

| Decision | Default | Notes |
| --- | --- | --- |
| File format | STL for meshes; STEP preferred when you have it | Accepted: `stl`, `obj`, `3mf`, `step`, `amf`; max 200 MB |
| Units | `mm` | Pass `fileUnit` explicitly on register — a silent unit mismatch scales the part 25.4× |
| Quantity | 1 | 1–100 |
| Destination | Ask — never assume a shipping country or address | Country affects which vendors quote and shipping cost |
| Material | User's stated requirement; otherwise quote broadly and present a spread | Use `materialId` to narrow once a family is chosen — much faster |
| Options presented | 3–5 quotes spanning price and process | Always include the cheapest; show vendor, material+finish, color, lead time, and full landed cost |
| Listing visibility | `private` | Order-fulfillment uploads should not appear on the public marketplace unless the user wants to sell the design |

**One-question policy**: ask one focused question only when missing information makes the order impossible or money-risky — shipping destination, material/strength requirements, or budget ceiling. Otherwise proceed to quotes with explicit assumptions. The pre-order confirmation (below) is mandatory and separate from this policy.

## Workflow

1. **Upload** — `materialize_request_upload_url` (filename, sizeBytes) → HTTP `PUT` the file bytes to the returned `uploadUrl` (valid 1 h) → `materialize_register_upload` (storageKey, originalFilename, format, fileSize, optional fileUnit, optional metadata) → returns `fileAssetId` + `fileId`. Set `metadata.visibility: "private"` unless told otherwise. The vendor-side model prep runs in the background — the file may need a few seconds before it quotes.
2. **Quote** — `materialize_get_quote` (fileAssetId, optional materialId, optional countryCode, optional quantity). Returns quotes sorted cheapest-first with `priceId`, `quoteId`, `vendorId`, `materialConfigId`, `shippingId`, `priceCents`, `shippingPriceCents`, lead times. Check `warnings` — a polling-deadline warning means results may be incomplete. Browse materials first with `materialize_list_materials` / `materialize_get_material` if the user needs guidance (properties, build volume, colors).
3. **Present options** — show 3–5 quotes with the full cost picture: production + shipping + 3% service fee (on the pre-shipping subtotal). State lead times as production days, not delivery dates.
4. **Confirm with the human** — before creating any order, get explicit approval of one specific quote: material + finish + color, vendor, quantity, total price, and the exact shipping address. Never invent or reuse an address without confirmation.
5. **Order** — `materialize_create_order` with the chosen quote's `quoteId`, `fileAssetId`, `vendorId`, `materialConfigId`, `shippingId`, `quantity`, `materialPriceCents`, `shippingPriceCents`, the `shippingAddress`, and an `idempotencyKey` (8–128 chars) you generate once per order intent. On timeout or network failure, retry with the **same** key — a new key risks a duplicate order.
6. **Relay the approval step** — the response tells you which path the order took (see below). Tell the user exactly what happens next; do not stop at "order created" without explaining that nothing ships until they approve.
7. **Track** — `materialize_get_order` (orderId) / `materialize_list_orders`. The response includes `status`, `terminal`, price breakdown, and tracking once shipped. Poll sparingly (the order won't change second-to-second), and read `references/order-lifecycle.md` before interpreting statuses.

## The approval model — read carefully

`materialize_create_order` never places an order directly. It creates a draft against the user's account, and the response's `status` field tells you which of exactly two paths it took:

- **`awaiting_user_approval`** (the default, and the only path unless the user has set up auto-approval): the order is parked. The user receives a confirmation email; they must open the `confirmationUrl`, review, and pay via Stripe within 24 h (`expiresAt`). **You must tell the user to check their email**, and give them the `confirmationUrl` directly — especially if the response carries a warning that the email failed to send.
- **`auto_approved`**: only possible when the user configured a spending policy on their token, the order fits it, the server-side agent-billing feature is enabled, and the off-session charge on their saved card succeeded. The card **has been charged**; the order is placed with the vendor after a short cancellation window (`cancellationDeadline`). Tell the user the amount charged and that they can cancel until that deadline via the emailed link or their dashboard.

A `reason` field on an `awaiting_user_approval` response explains why auto-approval fell through (over budget, card declined, …). Relay it; do not retry to force the auto path.

## Honesty rails

- **Never claim an order is placed** until a tool response proves it: `awaiting_user_approval` means *not placed, not paid* — say so in those words. `auto_approved` means *paid, placed after the cancellation window*. Only a status of `ordered` (or later) from `materialize_get_order` means the vendor has the order.
- **Always disclose the money**: the user pays `totalPriceCents + serviceFeeCents` (the 3% Materialize fee). Production and shipping prices come from the vendor's live quote, not from Materialize, and `totalPriceCents` in the order response is authoritative — it can slightly exceed your quote math because vendors apply a minimum-production fee.
- **Quotes expire and prices move.** If order creation fails with a quote-expired error, re-quote and re-present if the price changed meaningfully — don't silently re-order at a new price.
- **Report only what actually ran.** If quoting hit its deadline or returned warnings, say the comparison may be incomplete. Do not fabricate lead times, vendor names, or material properties — they all come from tool responses.
- **Do not claim manufacturability.** A returned quote means a vendor priced the geometry, not that the design will survive printing or is fit for purpose.

## Safety — hard rules

- **Never bypass the confirmation flow.** Do not attempt to approve, pay for, or "complete" an order on the user's behalf; there is no tool for that, by design. The confirmation URL and email are for the human.
- **Never fabricate spending-policy state.** You cannot see the user's policy, budget, or the server's billing switch. Treat every order as email-confirm-by-default; auto-approval is something you *discover* from a response, never something you promise or engineer toward.
- **Never split an order to sneak under a budget cap**, retry a declined charge, or mint a fresh idempotency key to get around "already started fulfillment" — that error means a real order exists; surface it.
- **A physical print is irreversible once in production.** When in doubt about geometry, size, units, material, or address — stop and ask.

## References

Load these when you reach the relevant step; do not preload:

- `references/order-lifecycle.md` — full status machine, both approval paths in detail, idempotency/replay semantics, cancellation and budget windows, fee math.
- `references/troubleshooting.md` — error-by-error fixes for upload, quoting, ordering, and auth failures.

## Tool surface (print-ordering subset)

| Tool | Purpose |
| --- | --- |
| `materialize_list_materials` | Browse the material catalog (filter by group/query) |
| `materialize_get_material` | One material's properties, build volume, finishes, colors |
| `materialize_request_upload_url` | Presigned URL for the model bytes |
| `materialize_register_upload` | Turn an uploaded object into a quotable `fileAssetId` |
| `materialize_list_files` | The user's registered models |
| `materialize_get_quote` | Live vendor quotes for a fileAsset (USD) |
| `materialize_create_order` | Create the draft order → user approval flow |
| `materialize_get_order` / `materialize_list_orders` | Status, price breakdown, tracking |

The server also exposes `materialize_*` tools for marketplace listings, photos, and project/build-guide publishing — out of scope here; discover them via MCP tool listing if the user wants to sell the design.
