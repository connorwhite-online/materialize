import { describe, it, expect } from "vitest";
import { postCommentSchema, editCommentSchema } from "../comment";

describe("postCommentSchema", () => {
  it("accepts a normal comment", () => {
    const r = postCommentSchema.safeParse({ body: "looks great" });
    expect(r.success).toBe(true);
  });

  it("trims whitespace", () => {
    const r = postCommentSchema.safeParse({ body: "  hi  " });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.body).toBe("hi");
  });

  it("rejects empty / whitespace-only", () => {
    expect(postCommentSchema.safeParse({ body: "" }).success).toBe(false);
    expect(postCommentSchema.safeParse({ body: "    " }).success).toBe(false);
  });

  it("rejects body over 5000 chars", () => {
    const r = postCommentSchema.safeParse({ body: "x".repeat(5001) });
    expect(r.success).toBe(false);
  });

  it("accepts an optional parentId UUID", () => {
    const r = postCommentSchema.safeParse({
      body: "ok",
      parentId: "11111111-1111-4111-8111-111111111111",
    });
    expect(r.success).toBe(true);
  });

  it("rejects a malformed parentId", () => {
    const r = postCommentSchema.safeParse({
      body: "ok",
      parentId: "not-a-uuid",
    });
    expect(r.success).toBe(false);
  });
});

describe("editCommentSchema", () => {
  it("accepts a normal edit", () => {
    expect(editCommentSchema.safeParse({ body: "updated" }).success).toBe(true);
  });

  it("rejects empty", () => {
    expect(editCommentSchema.safeParse({ body: "" }).success).toBe(false);
  });

  it("rejects body over 5000 chars", () => {
    expect(
      editCommentSchema.safeParse({ body: "x".repeat(5001) }).success
    ).toBe(false);
  });
});
