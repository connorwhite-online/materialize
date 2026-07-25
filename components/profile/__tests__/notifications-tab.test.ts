/**
 * Regression test for MTR-138.
 *
 * `buildHref` had no case for `collaborator_added_to_project`, so it
 * fell through to the comment-anchor branch, which casts the payload
 * `as ReplyToCommentPayload` and reads a nonexistent `commentId` —
 * producing a link to `${base}#comment-undefined` instead of the
 * project page. `buildMessage` already handled this type correctly
 * (see the sibling switch statement), showing the missing `buildHref`
 * case was an oversight, not an intentional gap.
 */
import { describe, it, expect, vi } from "vitest";

// notifications-tab.tsx imports the real `@/lib/db` client at module
// scope, which throws without DATABASE_URL set. Stub it — this test
// only exercises the pure `buildHref` link-building function and never
// touches the DB.
vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({ limit: () => Promise.resolve([]) }),
        }),
      }),
    }),
  },
}));

import {
  buildHref,
  buildMessage,
  hasUsableActor,
  type Row,
} from "../notifications-tab";
import type { CollaboratorAddedToProjectPayload } from "@/lib/notifications/types";

function makeRow(overrides: Partial<Row> = {}): Row {
  const payload: CollaboratorAddedToProjectPayload = {
    actor: {
      id: "actor-1",
      username: "ada",
      displayName: "Ada Lovelace",
      avatarUrl: null,
    },
    listing: {
      kind: "project",
      slug: "my-robot-arm",
      name: "My Robot Arm",
    },
  };
  return {
    id: "notif-1",
    type: "collaborator_added_to_project",
    payload,
    readAt: null,
    createdAt: new Date("2026-01-01"),
    ...overrides,
  };
}

describe("buildHref — collaborator_added_to_project (MTR-138)", () => {
  it("links to the project page, not a comment anchor", () => {
    const href = buildHref(makeRow());
    expect(href).toBe("/projects/my-robot-arm");
  });

  it("never produces the #comment-undefined fallthrough", () => {
    const href = buildHref(makeRow());
    expect(href).not.toContain("#comment-undefined");
    expect(href).not.toContain("#comment-");
  });

  it("still routes file-listing comment notifications to their comment anchor (no regression)", () => {
    const href = buildHref(
      makeRow({
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
        } as unknown as CollaboratorAddedToProjectPayload,
      })
    );
    expect(href).toBe("/files/gear-bracket#comment-comment-42");
  });
});

/**
 * MTR-240: `notifications.type` is free-form text by design — new
 * event types don't need a migration (AGENTS.md "Notifications"). The
 * inbox renderer previously assumed every row matched a known
 * `NotificationType` and had a well-formed payload:
 *   - `r.type as NotificationType` was an unchecked cast.
 *   - `NotificationRow` destructured `row.payload.actor` with no
 *     guard — a payload lacking `actor` threw and took down the
 *     entire tab's server render, not just one row.
 *   - `buildMessage` had no `default:` arm (unknown type → "").
 *   - `buildHref` fell through to the `comment_on_listing` /
 *     `reply_to_comment` branch for any unrecognized type, reading a
 *     nonexistent `commentId` and producing `#comment-undefined`.
 */
describe("hasUsableActor (MTR-240 row guard)", () => {
  it("accepts a payload with an object actor", () => {
    expect(hasUsableActor({ actor: { id: "u1" } })).toBe(true);
  });

  it("rejects payload: {} (no actor at all)", () => {
    expect(hasUsableActor({})).toBe(false);
  });

  it("rejects a non-object payload", () => {
    expect(hasUsableActor(null)).toBe(false);
    expect(hasUsableActor(undefined)).toBe(false);
    expect(hasUsableActor("a string")).toBe(false);
  });

  it("rejects a payload whose actor is not an object", () => {
    expect(hasUsableActor({ actor: "not-an-object" })).toBe(false);
    expect(hasUsableActor({ actor: null })).toBe(false);
  });

  it("rejects an actor with no id — UserAvatar's seed fallback would be undefined", () => {
    // seed={actor.username || actor.id}; if both are absent,
    // getAvatarGradient(undefined) throws on `str.length`.
    expect(hasUsableActor({ actor: {} })).toBe(false);
    expect(hasUsableActor({ actor: { username: "ada" } })).toBe(false);
  });

  it("accepts an actor with only an id (username/displayName/avatarUrl optional)", () => {
    expect(hasUsableActor({ actor: { id: "u1" } })).toBe(true);
  });
});

describe("buildMessage — unknown type fallback (MTR-240)", () => {
  it("falls back to generic copy for a type outside the known union", () => {
    const row = makeRow({
      // Free-form column — a future writer can ship a type this
      // component has never seen.
      type: "some_future_type" as unknown as Row["type"],
    });
    expect(buildMessage(row)).toBe("sent you a notification");
  });

  it("known types still render their specific copy (no regression)", () => {
    const cases: Array<[Row["type"], string]> = [
      ["comment_on_listing", "commented"],
      ["reply_to_comment", "replied to your comment"],
      ["build_on_file", "added a photo"],
      ["print_on_file", "just printed"],
      ["purchase_on_listing", "bought"],
      ["refund_on_listing", "was refunded for"],
      ["collaborator_added_to_project", "added you as a collaborator on"],
    ];
    for (const [type, expected] of cases) {
      expect(buildMessage(makeRow({ type }))).toBe(expected);
    }
  });
});

describe("buildHref — unknown type + malformed listing (MTR-240)", () => {
  it("lands on the listing base URL for an unknown type (no #comment-undefined)", () => {
    const href = buildHref(
      makeRow({ type: "some_future_type" as unknown as Row["type"] })
    );
    expect(href).toBe("/projects/my-robot-arm");
    expect(href).not.toContain("#comment-undefined");
  });

  it("falls back to the dashboard when the listing itself is malformed", () => {
    const row = makeRow({
      type: "some_future_type" as unknown as Row["type"],
      payload: {
        actor: {
          id: "actor-1",
          username: "ada",
          displayName: "Ada Lovelace",
          avatarUrl: null,
        },
        // no `listing` at all
      } as unknown as CollaboratorAddedToProjectPayload,
    });
    expect(buildHref(row)).toBe("/dashboard");
  });

  it("known types are unaffected by the malformed-listing fallback", () => {
    const href = buildHref(makeRow());
    expect(href).toBe("/projects/my-robot-arm");
  });
});
