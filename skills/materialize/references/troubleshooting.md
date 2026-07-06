# Troubleshooting — error-by-error fixes

Errors come back as `{ "error": { code, message, retryable } }` in the tool's JSON
text block. `retryable: true` means a plain retry is safe; everything else, look it
up here. Never loop blind retries on a non-retryable error.

## Auth / connection

| Symptom | Cause | Fix |
| --- | --- | --- |
| 401 / unauthorized on every call | Token missing, expired, or revoked | User mints a new token at `<origin>/dashboard/settings/tokens` and updates the MCP header |
| `invalid_scope` | Token lacks the scope for that tool | User must mint a broader token (this workflow needs `catalog:read`, `files:read`, `files:write`, `quotes:read`, `orders:create`, `orders:read`). You cannot fix this yourself — say which scope was missing |
| Endpoint 404 / HTML response | Wrong origin or path | Endpoint is `<origin>/api/mcp`, streamable HTTP. The tokens page displays the exact URL — have the user copy it from there |

## Upload

| Symptom | Cause | Fix |
| --- | --- | --- |
| `PUT` to `uploadUrl` fails with 403 | Presigned URL expired (1 h) or bytes don't match the declared `sizeBytes` | Call `materialize_request_upload_url` again and re-PUT promptly; send raw file bytes, not multipart |
| Register rejects the file | Format not in `stl/obj/3mf/step/amf`, or over 200 MB | Convert/decimate the mesh; STEP preferred for CAD parts, STL for meshes |
| Quote returns nothing right after upload | Vendor-side model prep still running | Wait a few seconds and re-quote once; this is normal latency, not an error |
| Part quotes at a wild price | Unit mismatch — file was interpreted at the wrong scale | Re-register with an explicit `fileUnit` (`mm` default; an inch-unit file read as mm shrinks 25.4×, and vice versa) |

## Quoting

| Symptom | Cause | Fix |
| --- | --- | --- |
| Response carries a polling-deadline warning | Vendor network didn't finish responding in time | Results are usable but possibly incomplete — say so when presenting; re-quote if the user wants a fuller spread |
| Empty quote list | No vendor prints that material to that country, or the geometry failed vendor checks | Try without `materialId` (broad quote), a different `countryCode`, or a different process family |
| Quotes for the wrong country | `countryCode` defaulted | Always pass the user's confirmed destination country — it changes vendors AND shipping |

## Ordering

| Symptom | Cause | Fix |
| --- | --- | --- |
| Quote-expired error | Prices moved since quoting | Re-quote; re-present if meaningfully different, then order with the fresh ids |
| Timeout / network failure on create | Unknown whether the draft was created | Retry with the **same** `idempotencyKey` — the original draft comes back if it exists |
| "Already started fulfillment" on replay | The original order is real and progressed | `materialize_get_order` it and report; do NOT mint a new key |
| Response has `reason` + `awaiting_user_approval` | Auto-approval fell through (budget, allowlist, card declined, feature off) | Relay the reason; proceed with the email-confirmation path — do not engineer around it |
| Warning that the confirmation email failed | Mail delivery problem | Hand the user the `confirmationUrl` from the response directly — it is their only way to approve |

## Order tracking

| Symptom | Cause | Fix |
| --- | --- | --- |
| Order stuck at `awaiting_user_approval` | The human hasn't approved/paid | That's their step, not yours. Remind once with the link; the draft expires 24 h after creation |
| Order resting at `ordered` for days | Fulfillment status sync isn't live yet | Normal — placed is placed. Don't report a problem; see `order-lifecycle.md` |
| Status you don't recognize | Server ahead of this skill | Report the raw status verbatim and the `terminal` flag; don't guess semantics |
