import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));

import { POST as aliasPost } from "../route";
import { GET as aliasGet } from "../poll/route";
import { POST } from "@/app/api/quotes/route";
import { GET } from "@/app/api/quotes/poll/route";

// The old paths survive one release for browsers on a pre-rename
// bundle. They must be the same handlers, not copies that can drift.
describe("deprecated /api/craftcloud/quotes aliases", () => {
  it("serve the /api/quotes handlers", () => {
    expect(aliasPost).toBe(POST);
    expect(aliasGet).toBe(GET);
  });
});
