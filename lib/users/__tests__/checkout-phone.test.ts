import { beforeEach, describe, expect, it, vi } from "vitest";

const set = vi.fn();
const where = vi.fn();
vi.mock("@/lib/db", () => ({
  db: {
    update: () => ({
      set: (v: unknown) => {
        set(v);
        return { where: (w: unknown) => where(w) };
      },
    }),
  },
}));
vi.mock("@/lib/logger", () => ({ logError: vi.fn() }));

import { rememberCheckoutPhone } from "../checkout-phone";

beforeEach(() => {
  set.mockReset();
  where.mockReset();
});

describe("rememberCheckoutPhone", () => {
  it("saves the trimmed phone on the user", async () => {
    await rememberCheckoutPhone("user_1", "  +1 212 555 0123 ");
    expect(set).toHaveBeenCalledWith({ phoneNumber: "+1 212 555 0123" });
  });

  it("skips blank phones", async () => {
    await rememberCheckoutPhone("user_1", "   ");
    await rememberCheckoutPhone("user_1", undefined);
    expect(set).not.toHaveBeenCalled();
  });

  it("never throws into checkout", async () => {
    where.mockRejectedValueOnce(new Error("db down"));
    await expect(rememberCheckoutPhone("user_1", "2125550123")).resolves.toBeUndefined();
  });
});
