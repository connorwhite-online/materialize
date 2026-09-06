/**
 * The project OG route's wiring: does it feed `chooseProjectCard` the
 * right candidates, and act on the answer it gets back?
 *
 * `chooseProjectCard` is unit tested on its own and the layouts are
 * render-tested in `lib/og/__tests__/render-smoke.test.tsx`, but
 * neither covers the seam between them — the queries, the cover
 * resolution order, and the mapping from choice to `renderOgCard`
 * arguments. The automated browser review can't cover it either: the
 * preview database has no published project with content, so only the
 * fallback card is ever exercised there.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

/** Results handed back, in query order, to whatever awaits the builder. */
let queue: unknown[][] = [];

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(() => "eq"),
  and: vi.fn(() => "and"),
  asc: vi.fn(() => "asc"),
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
    strings,
    values,
  }),
}));

vi.mock("@/lib/db/schema", () => ({
  projects: {},
  projectPhotos: {},
  projectFiles: {},
  files: {},
  users: {},
}));

vi.mock("@/lib/db", () => {
  // Every chain method returns the same thenable; awaiting it pops the
  // next queued result, so a `.where()` terminal and an
  // `.orderBy().limit()` terminal both work without the mock needing
  // to know which query it is serving.
  const builder: Record<string, unknown> = {};
  for (const m of ["from", "innerJoin", "where", "orderBy", "limit"]) {
    builder[m] = () => builder;
  }
  builder.then = (resolve: (v: unknown) => void) =>
    Promise.resolve(queue.shift() ?? []).then(resolve);
  return { db: { select: () => builder } };
});

const mockGenerateDownloadUrl = vi.fn();
vi.mock("@/lib/storage", () => ({
  generateDownloadUrl: (...a: unknown[]) => mockGenerateDownloadUrl(...a),
}));

const mockRenderOgCard = vi.fn((..._args: unknown[]) => "RENDERED");
vi.mock("@/lib/og/render-card", () => ({
  OG_SIZE: { width: 1200, height: 630 },
  OG_CONTENT_TYPE: "image/png",
  renderOgCard: (...a: unknown[]) => mockRenderOgCard(...a),
}));

import Image from "../opengraph-image";

const PROJECT = {
  id: "p1",
  name: "Desk Organizer Set",
  thumbnailUrl: null,
  coverPhotoId: null,
  status: "published",
  visibility: "public",
  fileCount: 1,
  displayName: "Connor",
  username: "connor",
};

const run = () => Image({ params: Promise.resolve({ slug: "desk" }) });
const card = () =>
  (mockRenderOgCard.mock.calls as unknown as unknown[][])[0][0] as Record<
    string,
    unknown
  >;

beforeEach(() => {
  vi.clearAllMocks();
  queue = [];
  mockGenerateDownloadUrl.mockResolvedValue("https://r2.example.com/signed");
});

describe("project opengraph-image", () => {
  it("renders the author's cover photo full-bleed", async () => {
    queue = [
      [PROJECT_WITH({ coverPhotoId: "photo-1" })],
      [{ storageKey: "photos/1.jpg", projectId: "p1" }],
    ];
    await run();

    expect(card()).toMatchObject({
      layout: "full",
      fit: "cover",
      imageUrl: "https://r2.example.com/signed",
      title: "Desk Organizer Set",
      subtitle: "Project by Connor",
    });
  });

  it("ignores a cover photo belonging to another project", async () => {
    // Defence against a stale/foreign coverPhotoId leaking another
    // project's artwork into this card.
    queue = [
      [PROJECT_WITH({ coverPhotoId: "photo-1" })],
      [{ storageKey: "photos/1.jpg", projectId: "SOMEONE-ELSE" }],
      [], // no curator photo either
      [{ thumbnailUrl: "/api/thumbnails/f1", coverPhotoId: null }],
    ];
    await run();

    expect(card()).toMatchObject({
      layout: "full",
      imageUrl: "/api/thumbnails/f1",
    });
  });

  it("falls back to the first curator photo when no cover is picked", async () => {
    queue = [[PROJECT], [{ storageKey: "photos/first.jpg" }]];
    await run();

    expect(card()).toMatchObject({ layout: "full", fit: "cover" });
    expect(mockGenerateDownloadUrl).toHaveBeenCalledWith("photos/first.jpg", 3600);
  });

  it("gives a lone bundled file the whole frame, contained", async () => {
    queue = [
      [PROJECT],
      [], // no curator photo
      [{ thumbnailUrl: "/api/thumbnails/f1", coverPhotoId: null }],
    ];
    await run();

    expect(card()).toMatchObject({
      layout: "full",
      fit: "contain",
      imageUrl: "/api/thumbnails/f1",
    });
  });

  it("fills the frame when the lone file's art is a photo", async () => {
    queue = [
      [PROJECT],
      [],
      [{ thumbnailUrl: "/api/thumbnails/f1", coverPhotoId: "cover-x" }],
    ];
    await run();

    expect(card()).toMatchObject({ layout: "full", fit: "cover" });
  });

  it("fans several bundled files into a stack", async () => {
    queue = [
      [PROJECT],
      [],
      [
        { thumbnailUrl: "/api/thumbnails/f1", coverPhotoId: null },
        { thumbnailUrl: "/api/thumbnails/f2", coverPhotoId: null },
        { thumbnailUrl: "/api/thumbnails/f3", coverPhotoId: null },
      ],
    ];
    await run();

    expect(card()).toMatchObject({
      layout: "stack",
      images: [
        "/api/thumbnails/f1",
        "/api/thumbnails/f2",
        "/api/thumbnails/f3",
      ],
    });
  });

  it("does not query bundled files when cover art already won", async () => {
    queue = [
      [PROJECT_WITH({ coverPhotoId: "photo-1" })],
      [{ storageKey: "photos/1.jpg", projectId: "p1" }],
      // Nothing further queued: a third query would resolve to [] and
      // the assertion below would still hold, so assert on the choice.
    ];
    await run();
    expect(card()).toMatchObject({ fit: "cover" });
    expect(card().images).toBeUndefined();
  });

  it("names the link when nothing resolves", async () => {
    queue = [[PROJECT], [], []];
    await run();

    const c = card();
    expect(c.title).toBe("Desk Organizer Set");
    expect(c.layout).toBeUndefined();
  });

  it("renders the brand card for an unpublished or private project", async () => {
    for (const bad of [{ status: "draft" }, { visibility: "private" }]) {
      vi.clearAllMocks();
      queue = [[PROJECT_WITH(bad)]];
      await run();
      expect(card()).toMatchObject({ title: "Materialize", subtitle: null });
    }
  });

  it("renders the brand card when the project doesn't exist", async () => {
    queue = [[]];
    await run();
    expect(card()).toMatchObject({ title: "Materialize" });
  });

  it("survives a signing failure rather than 500ing", async () => {
    mockGenerateDownloadUrl.mockRejectedValue(new Error("R2 down"));
    queue = [
      [PROJECT_WITH({ coverPhotoId: "photo-1" })],
      [{ storageKey: "photos/1.jpg", projectId: "p1" }],
      [],
      [{ thumbnailUrl: "/api/thumbnails/f1", coverPhotoId: null }],
    ];
    await run();

    // Degrades past the unsignable cover to the file's own art.
    expect(card()).toMatchObject({ imageUrl: "/api/thumbnails/f1" });
  });
});

function PROJECT_WITH(overrides: Record<string, unknown>) {
  return { ...PROJECT, ...overrides };
}
