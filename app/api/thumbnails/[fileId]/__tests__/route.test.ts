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
// The main file query is now: select().from().leftJoin().where()
// The optional ?photoId second query is: select().from().where()
// We mock both via mockDbWhere as the terminal .where() call, so
// consecutive mockResolvedValueOnce() chains work across both paths.
const mockDbWhere = vi.fn();
const mockDbLeftJoin = vi.fn(() => ({ where: mockDbWhere }));

vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        // The main file query uses leftJoin before where
        leftJoin: mockDbLeftJoin,
        // The ?photoId second query goes straight to where
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

function makeRequest(fileId: string, query?: string) {
  const qs = query ? `?${query}` : "";
  const req = new Request(`http://localhost/api/thumbnails/${fileId}${qs}`);
  const context = { params: Promise.resolve({ fileId }) };
  return { req, context };
}

// ── tests ──────────────────────────────────────────────────────────────────

// Import AFTER mocks are registered so vi.mock hoisting takes effect.
import { GET } from "../route";
import { generateDownloadUrl } from "@/lib/storage";

describe("GET /api/thumbnails/[fileId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // The main file query goes through leftJoin before where; reset both.
    mockDbLeftJoin.mockImplementation(() => ({ where: mockDbWhere }));
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

    it("returns 404 for an empty fileId without querying the DB", async () => {
      const { req, context } = makeRequest("");
      const res = await GET(req, context);

      // Use 404 (not 400) so scrapers can't fingerprint the route shape.
      expect(res.status).toBe(404);
      expect(mockDbWhere).not.toHaveBeenCalled();
    });
  });

  describe("valid UUID fileId", () => {
    it("serves a transparent placeholder (200) when the file does not exist (issue #63)", async () => {
      // Override the default mock: DB query succeeds but returns empty.
      // A valid-format id that backs no row used to 404; it now returns
      // a transparent PNG so a stale preview-seed reference can't trip
      // the browser-review "zero network failures" assertion.
      mockDbWhere.mockResolvedValue([]);
      const { req, context } = makeRequest("00000000-0000-0000-0000-000000000000");
      const res = await GET(req, context);

      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toBe("image/png");
      // DB WAS queried — the UUID passed validation.
      expect(mockDbWhere).toHaveBeenCalled();
    });

    it("serves a placeholder (200) when the backing R2 object is missing (issue #63)", async () => {
      // thumbnailUrl is recorded but the signed-URL fetch 404s — the
      // exact "stale preview seed" gap. The route must degrade to an
      // empty tile, not the 502 it would return for a real infra error.
      const fileId = "ba14f9ed-106b-46e3-8abc-123456789012";
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValue(new Response("missing", { status: 404 }));

      mockDbWhere.mockResolvedValueOnce([
        {
          id: fileId,
          thumbnailUrl: `/api/thumbnails/${fileId}`,
          status: "published",
          userId: "user-1",
          coverPhotoId: null,
          coverStorageKey: null,
        },
      ]);

      const { req, context } = makeRequest(fileId);
      const res = await GET(req, context);

      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toBe("image/png");

      fetchSpy.mockRestore();
    });

    it("still 502s when the upstream fails for a non-404 reason", async () => {
      // A genuine infra failure (R2 5xx) is a real problem — it must
      // NOT be masked by the placeholder, which is reserved for a
      // genuinely-absent object (404).
      const fileId = "ba14f9ed-106b-46e3-8abc-123456789012";
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValue(new Response("boom", { status: 503 }));

      mockDbWhere.mockResolvedValueOnce([
        {
          id: fileId,
          thumbnailUrl: `/api/thumbnails/${fileId}`,
          status: "published",
          userId: "user-1",
          coverPhotoId: null,
          coverStorageKey: null,
        },
      ]);

      const { req, context } = makeRequest(fileId);
      const res = await GET(req, context);

      expect(res.status).toBe(502);

      fetchSpy.mockRestore();
    });

    it("streams upstream bytes for a published file with a thumbnail", async () => {
      // The route fetches the signed R2 URL server-side and pipes the
      // response body back through this origin (rather than 302ing) so
      // next/image's optimizer can consume it — the optimizer rejects
      // redirect responses. Stub global fetch to return a fake R2
      // response.
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValue(
          new Response("FAKE_WEBP_BYTES", {
            status: 200,
            headers: {
              "Content-Type": "image/webp",
              "Content-Length": "15",
              ETag: '"abc123"',
            },
          })
        );

      mockDbWhere
        .mockResolvedValueOnce([
          {
            id: "ba14f9ed-106b-46e3-8abc-123456789012",
            thumbnailUrl: "/api/thumbnails/ba14f9ed-106b-46e3-8abc-123456789012",
            status: "published",
            userId: "user-1",
            coverPhotoId: null,
            coverStorageKey: null,
          },
        ])
        .mockResolvedValue([]);

      const { req, context } = makeRequest("ba14f9ed-106b-46e3-8abc-123456789012");
      const res = await GET(req, context);

      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toBe("image/webp");
      expect(res.headers.get("Cache-Control")).toMatch(/public/);
      expect(res.headers.get("ETag")).toBe('"abc123"');
      expect(fetchSpy).toHaveBeenCalledWith(
        "https://r2.example.com/signed-url",
        expect.any(Object)
      );

      fetchSpy.mockRestore();
    });

    it("?original=1 pins to the auto-captured key even when a cover is set", async () => {
      // Regression: the cover picker's "Auto" tile was rendering the
      // current cover photo (visually duplicating the curator-photo
      // tile next to it) because /api/thumbnails/{fileId} falls
      // through to coverPhotoId when no query is present. ?original=1
      // is the escape hatch the picker uses to fetch just the
      // auto-captured asset; this test guards both the bypass AND
      // that we don't waste a DB call looking up the cover row.
      const fileId = "ba14f9ed-106b-46e3-8abc-123456789012";
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValue(
          new Response("FAKE_WEBP_BYTES", {
            status: 200,
            headers: { "Content-Type": "image/webp" },
          })
        );

      mockDbWhere.mockResolvedValueOnce([
        {
          id: fileId,
          thumbnailUrl: `/api/thumbnails/${fileId}`,
          status: "published",
          userId: "user-1",
          coverPhotoId: "cccccccc-cccc-cccc-cccc-cccccccccccc",
          coverStorageKey: "photos/some-cover.webp",
        },
      ]);

      const { req, context } = makeRequest(fileId, "original=1");
      const res = await GET(req, context);

      expect(res.status).toBe(200);
      // The whole point: signing happens against the auto path, not
      // the cover photo's storageKey.
      expect(vi.mocked(generateDownloadUrl)).toHaveBeenCalledWith(
        `thumbnails/${fileId}.webp`,
        expect.any(Number)
      );
      // And the cover-photo lookup is skipped — only the files row
      // should have been queried.
      expect(mockDbWhere).toHaveBeenCalledTimes(1);

      fetchSpy.mockRestore();
    });
  });
});
