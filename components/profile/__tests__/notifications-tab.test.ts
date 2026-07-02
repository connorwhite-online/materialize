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

import { buildHref, type Row } from "../notifications-tab";
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
