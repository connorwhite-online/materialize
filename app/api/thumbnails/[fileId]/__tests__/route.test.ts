import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Regression test for Sentry event 7484237159.
 *
 * Root cause: the route forwarded the raw `fileId` URL segment to
 * Postgres without validating UUID format. When a malformed id
 * (e.g. "ba14f9ed-106b-46e3-8", a truncated UUID) arrived via a
 * HEAD /_next/image request, Postgres threw
 *   "invalid input syntax for type uuid"
 * which the route's try-catch turned into a 500 + Sentry event.
 *
 * Fix: validate UUID format before touching the DB and return 404
 * immediately for any non-UUID segment.
 */

// ── DB mock ────────────────────────────────────────────────────────────────
// `mockDbWhere` is the terminal method of the query chain
// (db.select().from().where()). We configure it per-test: by default it
// throws a Postgres-style "invalid input syntax" error to simulate what
// a real Neon instance would do with a non-UUID $1 param. Tests that
// need a valid lookup return an appropriate row instead.
const mockDbWhere = vi.fn();

vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: mockDbWhere,
      }),
    }),
  },
}));

vi.mock("@/lib/db/schema", () => ({
  files: { id: "id", thumbnailUrl: "thumbnailUrl", status: "status", userId: "userId", coverPhotoId: "coverPhotoId" },
  filePhotos: { id: "id", storageKey: "storageKey", fileId: "fileId" },
}));

vi.mock("@/lib/storage", () => ({
  generateDownloadUrl: vi.fn().mockResolvedValue("https://r2.example.com/signed-url"),
}));

vi.mock("@/lib/logger", () => ({
  logError: vi.fn(),
}));

// ── helpers ────────────────────────────────────────────────────────────────

function makeRequest(fileId: string, photoId?: string) {
  const qs = photoId ? `?photoId=${photoId}` : "";
  const req = new Request(`http://localhost/api/thumbnails/${fileId}${qs}`);
  const context = { params: Promise.resolve({ fileId }) };
  return { req, context };
}

// ── tests ──────────────────────────────────────────────────────────────────

// Import AFTER mocks are registered so vi.mock hoisting takes effect.
import { GET } from "../route";

describe("GET /api/thumbnails/[fileId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: simulate Postgres rejecting an invalid UUID.  Tests that
    // exercise the DB-lookup path override this to resolve with data.
    mockDbWhere.mockRejectedValue(
      Object.assign(
        new Error(
          'Failed query: select "id", "thumbnail_url", "status", "user_id", "cover_photo_id" from "files" where "files"."id" = $1\nparams: ba14f9ed-106b-46e3-8'
        ),
        { code: "22P02" } // Postgres "invalid_text_representation"
      )
    );
  });

  describe("malformed / non-UUID fileId (sentry 7484237159)", () => {
    it("returns 404 for a truncated UUID and does NOT touch the DB", async () => {
      const { req, context } = makeRequest("ba14f9ed-106b-46e3-8");
      const res = await GET(req, context);

      // Must NOT be a 500 — that was the pre-fix behaviour when
      // Postgres threw "invalid input syntax for type uuid".
      expect(res.status).toBe(404);

      // Crucially, the DB must not have been queried at all.
      expect(mockDbWhere).not.toHaveBeenCalled();
    });

    it("returns 404 for a plain non-UUID string without querying the DB", async () => {
      const { req, context } = makeRequest("not-a-uuid");
      const res = await GET(req, context);

      expect(res.status).toBe(404);
      expect(mockDbWhere).not.toHaveBeenCalled();
    });

    it("returns 400 for an empty fileId without querying the DB", async () => {
      const { req, context } = makeRequest("");
      const res = await GET(req, context);

      expect(res.status).toBe(400);
      expect(mockDbWhere).not.toHaveBeenCalled();
    });
  });

  describe("valid UUID fileId", () => {
    it("returns 404 when the file does not exist", async () => {
      // Override the default mock: DB query succeeds but returns empty.
      mockDbWhere.mockResolvedValue([]);
      const { req, context } = makeRequest("00000000-0000-0000-0000-000000000000");
      const res = await GET(req, context);

      expect(res.status).toBe(404);
      // DB WAS queried — the UUID passed validation.
      expect(mockDbWhere).toHaveBeenCalled();
    });

    it("returns 302 redirect for a published file with a thumbnail", async () => {
      // First call: files lookup; second: would be filePhotos (skipped if
      // no coverPhotoId). Use a chainable mock so consecutive calls work.
      mockDbWhere
        .mockResolvedValueOnce([
          {
            id: "ba14f9ed-106b-46e3-8abc-123456789012",
            thumbnailUrl: "/api/thumbnails/ba14f9ed-106b-46e3-8abc-123456789012",
            status: "published",
            userId: "user-1",
            coverPhotoId: null,
          },
        ])
        // No further DB calls for the happy path without coverPhotoId.
        .mockResolvedValue([]);

      const { req, context } = makeRequest("ba14f9ed-106b-46e3-8abc-123456789012");
      const res = await GET(req, context);

      expect(res.status).toBe(302);
      expect(res.headers.get("Location")).toBe("https://r2.example.com/signed-url");
      expect(res.headers.get("Cache-Control")).toMatch(/public/);
    });
  });
});
