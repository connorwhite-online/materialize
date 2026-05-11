/**
 * Print-order statuses that count as "this user actually printed it."
 *
 * Drafts (`quoting`, `cart_created`, `awaiting_agent_approval`) and
 * failure states (`blocked`, `cancelled`, `refunded`) are excluded —
 * those aren't real prints.
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
