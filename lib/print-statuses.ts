/**
 * Print-order statuses that count as "this user actually printed it."
 *
 * Drafts (`quoting`, `cart_created`, `awaiting_agent_approval`) and
 * failure states (`blocked`, `cancelled`, `refunded`) are excluded —
 * those aren't real prints.
 *
 * `auto_approved` IS included on purpose — the user has committed
 * financially (the off-session PaymentIntent succeeded); the order is
 * just inside its cancellation window before CraftCloud placement.
 * Excluding it would cause a race where a just-auto-approved order
 * temporarily looks like a non-print.
 *
 * `awaiting_production_payment` is correctly excluded — the two-step
 * fee authorization has cleared but the user hasn't paid CraftCloud yet,
 * so production hasn't started. It advances to `ordered` once confirmed.
 *
 * Used by:
 *   - the file detail activity stream (PrintActivity rows)
 *   - the builds-gate entitlement helper (a user can post a "build" for
 *     a file iff they've downloaded it OR have a print order in this
 *     state set)
 */
export const PRINTED_STATUSES = [
  "auto_approved",
  "ordered",
  "in_production",
  "shipped",
  "received",
] as const;
