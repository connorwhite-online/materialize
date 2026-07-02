// @vitest-environment jsdom
//
// Exhaustiveness test for the 12-state printOrderStatusEnum against the
// scattered "consumer checklist" documented in AGENTS.md (CON-153):
// every place that branches on printOrderStatus must be updated when a
// status is added, renamed, or removed — otherwise a new status
// silently falls through a `default:` somewhere (this has already
// happened once: CON-114, "auto_approved/awaiting_agent_approval/
// quoting statuses render as blank").
//
// This test imports the REAL consumer maps (not copies). Three of them
// (TERMINAL_STATUSES in lib/mcp/internal/orders.ts, ACTIVE_ORDER_STATUSES
// in app/actions/files.ts, and STATUS_LABELS in the order detail page)
// were not exported prior to MTR-155 — a bare `export` keyword was added
// to each (no logic change) so this test can assert against the live
// map instead of a hand-copied duplicate that could drift silently.
//
// Two different exhaustiveness shapes appear here:
//   - Allow-lists (TERMINAL_STATUSES, ACTIVE_ORDER_STATUSES,
//     PRINTED_STATUSES) are deliberately PARTIAL by design — only a
//     subset of statuses are "terminal" / "active" / "printed". The
//     meaningful invariant for these is VALIDITY: every member must be
//     a real enum value (no stale/typo'd status lingering after a
//     rename). Full coverage is a business decision made when a status
//     is added, not something a generic test can arbitrate — that
//     part is documented, not asserted.
//   - Label maps (STATUS_LABELS/STATUS_VARIANT) are consulted for
//     EVERY order's status when rendering, so they must be exhaustive:
//     every enum value needs a key or the UI shows a blank/raw label.

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { printOrderStatusEnum } from "@/lib/db/schema";

const ALL_STATUSES = printOrderStatusEnum.enumValues;

describe("printOrderStatusEnum", () => {
  it("has the 12 documented states (AGENTS.md CON-153) — sanity check so drift here fails loudly", () => {
    expect(ALL_STATUSES).toEqual([
      "quoting",
      "cart_created",
      "awaiting_agent_approval",
      "auto_approved",
      "awaiting_production_payment",
      "ordered",
      "in_production",
      "shipped",
      "received",
      "blocked",
      "refunded",
      "cancelled",
    ]);
  });
});

describe("allow-list consumers (partial by design — members must stay valid)", () => {
  it("lib/mcp/internal/orders.ts TERMINAL_STATUSES — every member is a real enum value", async () => {
    const { TERMINAL_STATUSES } = await import("@/lib/mcp/internal/orders");
    for (const status of TERMINAL_STATUSES) {
      expect(ALL_STATUSES).toContain(status);
    }
    // Document current coverage so a future status addition/removal is
    // visible in a PR diff instead of silently changing test intent.
    expect([...TERMINAL_STATUSES].sort()).toEqual(
      ["cancelled", "received", "refunded"].sort()
    );
  });

  it("app/actions/files.ts ACTIVE_ORDER_STATUSES — every member is a real enum value", async () => {
    const { ACTIVE_ORDER_STATUSES } = await import("@/app/actions/files");
    for (const status of ACTIVE_ORDER_STATUSES) {
      expect(ALL_STATUSES).toContain(status);
    }
    expect([...ACTIVE_ORDER_STATUSES].sort()).toEqual(
      [
        "cart_created",
        "awaiting_agent_approval",
        "auto_approved",
        "awaiting_production_payment",
        "ordered",
        "in_production",
        "shipped",
      ].sort()
    );
  });

  it("lib/print-statuses.ts PRINTED_STATUSES — every member is a real enum value", async () => {
    const { PRINTED_STATUSES } = await import("@/lib/print-statuses");
    for (const status of PRINTED_STATUSES) {
      expect(ALL_STATUSES).toContain(status);
    }
    expect([...PRINTED_STATUSES].sort()).toEqual(
      ["auto_approved", "ordered", "in_production", "shipped", "received"].sort()
    );
  });

  it("documents which statuses are NOT covered by any allow-list (informational — not necessarily a bug)", async () => {
    const { TERMINAL_STATUSES } = await import("@/lib/mcp/internal/orders");
    const { ACTIVE_ORDER_STATUSES } = await import("@/app/actions/files");
    const { PRINTED_STATUSES } = await import("@/lib/print-statuses");

    const covered = new Set<string>([
      ...TERMINAL_STATUSES,
      ...ACTIVE_ORDER_STATUSES,
      ...PRINTED_STATUSES,
    ]);
    const uncovered = ALL_STATUSES.filter((s) => !covered.has(s));

    // `quoting` is documented dead (AGENTS.md: "the column default
    // only; no writer ever sets it, no code reads it"), so it's
    // expected to sit outside every allow-list. `blocked` is a
    // mid-state pending user action (request a refund, which then
    // moves it to `refunded` — the actually-terminal state) rather
    // than terminal itself, so its absence from TERMINAL_STATUSES is
    // also by design. If this assertion ever needs to change, that's
    // a real signal a status's classification changed and the sibling
    // maps above should be re-audited by a human, not silently
    // patched here.
    expect(uncovered.sort()).toEqual(["blocked", "quoting"]);
  });
});

describe("label maps (must key every status — a miss renders a blank/raw label)", () => {
  it("components/profile/orders-tab.tsx STATUS_LABELS covers every status", async () => {
    const { STATUS_LABELS } = await import("@/components/profile/orders-tab");
    const missing = ALL_STATUSES.filter((s) => !(s in STATUS_LABELS));
    expect(missing).toEqual([]);
  });

  it("components/profile/orders-tab.tsx STATUS_VARIANT covers every status", async () => {
    const { STATUS_VARIANT } = await import("@/components/profile/orders-tab");
    const missing = ALL_STATUSES.filter((s) => !(s in STATUS_VARIANT));
    expect(missing).toEqual([]);
  });

  it("app/(app)/dashboard/orders/[orderId]/page.tsx STATUS_LABELS covers every status", async () => {
    const { STATUS_LABELS } = await import(
      "@/app/(app)/dashboard/orders/[orderId]/page"
    );
    const missing = ALL_STATUSES.filter((s) => !(s in STATUS_LABELS));
    expect(missing).toEqual([]);
  });
});

describe("components/print/order-status-tracker.tsx STEPS array (rendered, not exported)", () => {
  // STEPS is a local const inside a client component — per MTR-155
  // scope, we assert via rendering rather than exporting component
  // internals. The component explicitly special-cases blocked/
  // cancelled/refunded outside of STEPS; every other status (including
  // the five pre-`ordered` statuses: quoting, cart_created,
  // awaiting_agent_approval, auto_approved, awaiting_production_payment)
  // falls through to the plain 4-step tracker with nothing marked
  // "current" (STEPS.findIndex returns -1). That fallback is a real,
  // deliberate rendering decision (an all-pending progress bar) — this
  // test documents it and asserts it never throws, rather than
  // asserting a false "every status gets a bespoke rendering" claim.
  it("renders without throwing for every enum value, and the three special statuses show distinct copy", async () => {
    const { OrderStatusTracker } = await import(
      "@/components/print/order-status-tracker"
    );

    for (const status of ALL_STATUSES) {
      const { unmount } = render(
        <OrderStatusTracker orderId="order-1" currentStatus={status} />
      );
      unmount();
    }

    const { unmount: unmountBlocked } = render(
      <OrderStatusTracker orderId="order-1" currentStatus="blocked" />
    );
    expect(screen.getByText("Order Could Not Be Completed")).toBeTruthy();
    unmountBlocked();

    const { unmount: unmountCancelled } = render(
      <OrderStatusTracker orderId="order-1" currentStatus="cancelled" />
    );
    expect(screen.getByText("Order Cancelled")).toBeTruthy();
    unmountCancelled();

    render(<OrderStatusTracker orderId="order-1" currentStatus="refunded" />);
    expect(screen.getByText("Order Refunded")).toBeTruthy();
  });

  it("the four STEPS statuses (ordered/in_production/shipped/received) render their step labels", async () => {
    const { OrderStatusTracker } = await import(
      "@/components/print/order-status-tracker"
    );

    render(<OrderStatusTracker orderId="order-1" currentStatus="ordered" />);
    expect(screen.getByText("Confirmed")).toBeTruthy();
    expect(screen.getByText("In Production")).toBeTruthy();
    expect(screen.getByText("Shipped")).toBeTruthy();
    expect(screen.getByText("Delivered")).toBeTruthy();
  });

  it("pre-order statuses (e.g. awaiting_agent_approval) fall through to the plain step tracker instead of crashing", async () => {
    const { OrderStatusTracker } = await import(
      "@/components/print/order-status-tracker"
    );

    render(
      <OrderStatusTracker
        orderId="order-1"
        currentStatus="awaiting_agent_approval"
      />
    );
    // Same STEPS labels render — none is visually "current", but the
    // component doesn't special-case this status, so it's the default
    // progress-bar shell. Documented gap: see file header comment.
    expect(screen.getByText("Confirmed")).toBeTruthy();
  });
});

describe("components/files/file-activity.tsx STATUS_LABEL (rendered, not exported)", () => {
  // PrintActivity rows are only ever queried with
  // `inArray(printOrders.status, [...PRINTED_STATUSES])` (see
  // app/(app)/files/[slug]/page.tsx), so STATUS_LABEL's real input
  // domain is PRINTED_STATUSES (5 statuses), not the full 12-state
  // enum. We assert exhaustiveness against that actual domain by
  // rendering — a status label map keyed only for its real inputs is
  // correct, not a gap.
  it("renders a non-raw label for every PRINTED_STATUSES value", async () => {
    const { PRINTED_STATUSES } = await import("@/lib/print-statuses");
    const { FileActivity } = await import("@/components/files/file-activity");

    const prints = PRINTED_STATUSES.map((status, i) => ({
      id: `print-${i}`,
      user: { id: "u1", username: "ada", displayName: "Ada", avatarUrl: null },
      materialLabel: null,
      vendorName: null,
      status,
      createdAt: new Date(),
    }));

    render(<FileActivity prints={prints} downloads={[]} />);

    for (const status of PRINTED_STATUSES) {
      // If STATUS_LABEL were missing a key, PrintRow falls back to the
      // raw status string (e.g. "in_production") — assert the raw
      // value never appears as rendered text.
      expect(screen.queryByText(status)).toBeNull();
    }
    // Spot check a couple of the actual labels render.
    expect(screen.getAllByText("Confirmed").length).toBeGreaterThan(0);
    expect(screen.getByText("Shipped")).toBeTruthy();
    expect(screen.getByText("Delivered")).toBeTruthy();
  });
});
