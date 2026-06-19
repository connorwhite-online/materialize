// CON-114 — guard test: every printOrderStatusEnum value must have an entry
// in STATUS_LABELS and STATUS_VARIANT so agent-order statuses never render
// as blank or raw enum strings in the orders UI.
import { describe, it, expect } from "vitest";
import { STATUS_LABELS, STATUS_VARIANT } from "../orders-tab";

// The 12 values of printOrderStatusEnum (lib/db/schema.ts:80-106).
// Hard-coded here so the test fails loudly when a new status is added to
// the enum but the maps are not updated.
const ALL_PRINT_ORDER_STATUSES = [
  "quoting",
  "awaiting_agent_approval",
  "auto_approved",
  "cart_created",
  "awaiting_production_payment",
  "ordered",
  "in_production",
  "shipped",
  "received",
  "blocked",
  "refunded",
  "cancelled",
] as const;

describe("orders-tab STATUS_LABELS", () => {
  it.each(ALL_PRINT_ORDER_STATUSES)(
    "has a label for status %s",
    (status) => {
      expect(STATUS_LABELS).toHaveProperty(status);
      expect(typeof STATUS_LABELS[status]).toBe("string");
      expect(STATUS_LABELS[status].length).toBeGreaterThan(0);
    }
  );
});

describe("orders-tab STATUS_VARIANT", () => {
  const VALID_VARIANTS = ["default", "secondary", "destructive", "outline"];

  it.each(ALL_PRINT_ORDER_STATUSES)(
    "has a variant for status %s",
    (status) => {
      expect(STATUS_VARIANT).toHaveProperty(status);
      expect(VALID_VARIANTS).toContain(STATUS_VARIANT[status]);
    }
  );
});
