import { describe, it, expect } from "vitest";
import { pushForNotification, pushForOrderStatus } from "../message";

const actor = { id: "u1", username: "ada", displayName: "Ada", avatarUrl: null };

describe("pushForNotification", () => {
  it("uses the email headline and the inbox's relative link", () => {
    const msg = pushForNotification("comment_on_listing", {
      actor,
      listing: { kind: "file", name: "Carabiner", slug: "carabiner" },
      commentId: "c1",
      snippet: "Nice print",
    });
    expect(msg).toEqual({
      title: "Ada commented on your file Carabiner",
      body: "Nice print",
      url: "/files/carabiner#comment-c1",
    });
  });

  it("links a print to the order and clips long bodies", () => {
    const msg = pushForNotification("print_on_file", {
      actor,
      listing: { kind: "file", name: "Carabiner", slug: "carabiner" },
      printOrderId: "o1",
      materialLabel: "x".repeat(400),
    });
    expect(msg.url).toBe("/dashboard/orders/o1");
    expect(msg.body!.length).toBe(180);
    expect(msg.body!.endsWith("…")).toBe(true);
  });
});

describe("pushForOrderStatus", () => {
  it("covers every status the fulfillment sweep can write after ordered", () => {
    for (const s of ["in_production", "shipped", "received", "blocked", "cancelled"]) {
      const msg = pushForOrderStatus("o1", s);
      expect(msg?.url).toBe("/dashboard/orders/o1");
      expect(msg?.tag).toBe("order-o1");
    }
  });

  it("stays quiet for statuses the buyer already knows about", () => {
    expect(pushForOrderStatus("o1", "ordered")).toBeNull();
  });
});
