// CON-30 — finished-order rows wrap Card in a Link. space-y's margin-top
// does not land on a default-inline <a>, so cards sat flush on iOS Safari.
// Pin the block Link + flex/gap stack (and Card py-0) so the gap can't
// silently regress to space-y-on-inline again.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";

const ordersTab = readFileSync(
  resolve(__dirname, "../orders-tab.tsx"),
  "utf8"
);
const draftCart = readFileSync(
  resolve(__dirname, "../draft-cart-card.tsx"),
  "utf8"
);

describe("orders-tab list layout (CON-30)", () => {
  it("stacks finished orders with flex+gap, not space-y", () => {
    // The finished-orders list is the second flex+gap stack in the file
    // (Carts is first). Both should use gap so Link children space
    // correctly; pin that space-y is gone from list containers.
    expect(ordersTab).toMatch(/className="flex flex-col gap-2"/);
    expect(ordersTab).not.toMatch(/className="space-y-2"/);
  });

  it("makes each order Link a block element", () => {
    expect(ordersTab).toMatch(
      /href=\{`\/dashboard\/orders\/\$\{order\.id\}`\}\s*\n\s*className="block"/
    );
  });

  it("zeros Card default py on list rows", () => {
    expect(ordersTab).toContain('className="py-0 transition-colors hover:border-primary/30"');
    expect(draftCart).toContain('className="py-0 transition-colors"');
  });
});
