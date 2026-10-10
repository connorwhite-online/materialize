import { describe, expect, it } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { shownInOwnerLibrary } from "../owner-library";

describe("shownInOwnerLibrary", () => {
  it("hides archived files unless the fingerprint check flagged them", () => {
    const { sql } = new PgDialect().sqlToQuery(shownInOwnerLibrary());
    expect(sql).toBe(
      '("files"."status" <> $1 or "files"."flagged_reason" is not null)'
    );
  });
});
