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

/**
 * Print-order statuses that represent a charged-or-about-to-be-charged
 * order — i.e. one still "in flight" enough that deleting the
 * referenced file must archive rather than hard-delete it, and that
 * should count toward an owner-facing "has buyers" gate.
 *
 * Keep this set in sync with the status machine in AGENTS.md (CON-153).
 * Any new status that represents a charged-or-about-to-be-charged order
 * must be added here.
 *
 * Includes charged-before-fulfillment statuses (CON-164):
 *   - awaiting_agent_approval: agent order created, policy eval in flight
 *   - auto_approved: off-session PI already charged; CraftCloud placement pending
 *   - awaiting_production_payment: two-step fee hold active; deleting
 *     the file would break resumption and refund context
 *   - blocked: factory-rejected but PAID and the primary self-service
 *     refund state (print.ts requestOrderRefund treats blocked as
 *     "refund is straightforward"); deleting the file while an order
 *     sits blocked would cascade-destroy the buyer's refund path and
 *     order history while the Stripe charge stands (MTR-231).
 *
 * Single source of truth used by both app/actions/files.ts
 * (deleteFileListing archive/hard-delete gate) and
 * app/(app)/files/[slug]/page.tsx (owner buyer-count display) — moved
 * here rather than exported from app/actions/files.ts because that
 * file has a top-level "use server" directive, and Next.js requires
 * every export of a "use server" file to be an async function
 * (https://nextjs.org/docs/messages/invalid-use-server-value); a plain
 * const array export there fails the build.
 */
export const ACTIVE_ORDER_STATUSES = [
  "cart_created",
  "awaiting_agent_approval",
  "auto_approved",
  "awaiting_production_payment",
  "ordered",
  "in_production",
  "shipped",
  "blocked",
] as const;
