// CON-30 — finished-order rows are Links. space-y's margin-top does not
// land on a default-inline <a>, so rows once sat flush on iOS Safari.
// Pin that list containers never rely on space-y and that each order
// Link is itself a flex (block-level) row.
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
  it("stacks rows with flex lists, not space-y", () => {
    expect(ordersTab).toMatch(/<ul className="[^"]*flex flex-col[^"]*"/);
    expect(ordersTab).not.toMatch(/space-y-/);
  });

  it("makes each order Link a flex row", () => {
    expect(ordersTab).toMatch(
      /href=\{`\/dashboard\/orders\/\$\{order\.id\}`\}\s*\n\s*className="group flex items-center/
    );
  });

  it("renders rows, not cards", () => {
    expect(ordersTab).not.toContain("<Card");
    expect(draftCart).not.toContain("<Card");
  });
});
