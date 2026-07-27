// @vitest-environment jsdom
/**
 * MTR-240 end-to-end regression: previously, a single malformed
 * notification row (e.g. `payload: {}`, no `actor`) threw while
 * mapping DB rows into render items, taking down the entire
 * Notifications tab's server render — not just that one row. This
 * renders the real `NotificationsTab` async server component against
 * a mocked DB result set that mixes one well-formed row with one
 * malformed row and asserts the tab renders without throwing, drops
 * the bad row, and keeps the good one.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

let mockRows: unknown[] = [];

vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({
            limit: () => Promise.resolve(mockRows),
          }),
        }),
      }),
    }),
  },
}));

import { NotificationsTab } from "../notifications-tab";

describe("NotificationsTab render (MTR-240)", () => {
  it("drops a malformed row (payload: {}) without throwing, and still renders the good row", async () => {
    mockRows = [
      {
        id: "notif-bad",
        type: "comment_on_listing",
        payload: {}, // no `actor` — the bug this guards against
        readAt: new Date("2026-01-01"),
        createdAt: new Date("2026-01-01"),
      },
      {
        id: "notif-good",
        type: "comment_on_listing",
        payload: {
          actor: {
            id: "actor-1",
            username: "ada",
            displayName: "Ada Lovelace",
            avatarUrl: null,
          },
          listing: { kind: "file", slug: "gear-bracket", name: "Gear Bracket" },
          commentId: "comment-42",
          snippet: "Nice print!",
        },
        readAt: new Date("2026-01-01"),
        createdAt: new Date("2026-01-02"),
      },
    ];

    let jsx: Awaited<ReturnType<typeof NotificationsTab>> | undefined;
    await expect(
      (async () => {
        jsx = await NotificationsTab({ userId: "user-1" });
      })()
    ).resolves.not.toThrow();

    render(jsx!);

    // Only the good row counts.
    expect(screen.getByText("1 total")).toBeTruthy();
    expect(screen.getByText("Ada Lovelace")).toBeTruthy();
    expect(screen.getByText("Gear Bracket")).toBeTruthy();
  });

  it("renders an unknown type with fallback copy and no listing chip when the listing is malformed", async () => {
    mockRows = [
      {
        id: "notif-unknown",
        type: "some_future_type",
        payload: {
          actor: {
            id: "actor-2",
            username: "grace",
            displayName: "Grace Hopper",
            avatarUrl: null,
          },
          // no `listing` — malformed for this hypothetical future type
        },
        readAt: new Date("2026-01-01"),
        createdAt: new Date("2026-01-01"),
      },
    ];

    const jsx = await NotificationsTab({ userId: "user-1" });
    render(jsx);

    expect(screen.getByText("Grace Hopper")).toBeTruthy();
    expect(screen.getByText("sent you a notification")).toBeTruthy();
    // No listing chip — "on <name>" — since the listing was malformed.
    expect(screen.queryByText(/^on /)).toBeNull();
  });
});
