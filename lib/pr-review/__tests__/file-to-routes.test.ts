import { describe, it, expect } from "vitest";
import { mapFilesToRoutes, formatRouteImpacts } from "../file-to-routes";

describe("mapFilesToRoutes", () => {
  it("extracts a simple static route from a page.tsx", () => {
    const out = mapFilesToRoutes(["app/(app)/materials/page.tsx"]);
    expect(out).toEqual([
      {
        path: "/materials",
        kind: "page",
        source: "app/(app)/materials/page.tsx",
        affectsSubtree: false,
      },
    ]);
  });

  it("preserves dynamic segments verbatim — agent does the substitution", () => {
    const out = mapFilesToRoutes([
      "app/(app)/files/[slug]/page.tsx",
      "app/(app)/[handle]/settings/page.tsx",
    ]);
    expect(out.map((r) => r.path)).toEqual([
      "/files/[slug]",
      "/[handle]/settings",
    ]);
  });

  it("strips route groups", () => {
    const out = mapFilesToRoutes([
      "app/(auth)/sign-in/[[...sign-in]]/page.tsx",
    ]);
    expect(out[0].path).toBe("/sign-in/[[...sign-in]]");
  });

  it("flags layouts as subtree-affecting", () => {
    const out = mapFilesToRoutes(["app/(app)/layout.tsx"]);
    expect(out[0]).toMatchObject({
      kind: "layout",
      affectsSubtree: true,
    });
  });

  it("flags root layout — affects every route", () => {
    const out = mapFilesToRoutes(["app/layout.tsx"]);
    expect(out[0]).toEqual({
      path: "/",
      kind: "layout",
      source: "app/layout.tsx",
      affectsSubtree: true,
    });
  });

  it("maps app/page.tsx to /", () => {
    const out = mapFilesToRoutes(["app/page.tsx"]);
    expect(out[0].path).toBe("/");
    expect(out[0].kind).toBe("page");
  });

  it("classifies api routes distinctly", () => {
    const out = mapFilesToRoutes([
      "app/api/thumbnails/[fileId]/route.ts",
      "app/api/craftcloud/quotes/route.ts",
    ]);
    expect(out.every((r) => r.kind === "api")).toBe(true);
    expect(out.map((r) => r.path)).toEqual([
      "/api/thumbnails/[fileId]",
      "/api/craftcloud/quotes",
    ]);
  });

  it("excludes server actions and internal webhook receivers", () => {
    const out = mapFilesToRoutes([
      "app/actions/files.ts",
      "app/actions/payouts.ts",
      "app/api/internal/sentry-trigger/route.ts",
    ]);
    expect(out).toEqual([]);
  });

  it("excludes test files even when colocated under app/", () => {
    const out = mapFilesToRoutes([
      "app/api/cron/sweep-fingerprint-stragglers/__tests__/route.test.ts",
      "app/actions/__tests__/files.test.ts",
    ]);
    expect(out).toEqual([]);
  });

  it("ignores non-route helper files in route directories", () => {
    const out = mapFilesToRoutes([
      "app/(app)/files/[slug]/page.tsx",
      "app/(app)/files/[slug]/helpers.ts",
      "app/(app)/files/[slug]/use-something.ts",
    ]);
    // Only the page.tsx produces a route impact; helpers are
    // tangentially related but the mapper deliberately stays out
    // of import-graph guessing.
    expect(out).toHaveLength(1);
    expect(out[0].source).toBe("app/(app)/files/[slug]/page.tsx");
  });

  it("groups page/loading/error in the same dir as distinct kinds at one path", () => {
    const out = mapFilesToRoutes([
      "app/(app)/files/[slug]/page.tsx",
      "app/(app)/files/[slug]/loading.tsx",
      "app/(app)/files/[slug]/error.tsx",
    ]);
    expect(out.map((r) => r.kind).sort()).toEqual([
      "error",
      "loading",
      "page",
    ]);
    expect(new Set(out.map((r) => r.path))).toEqual(new Set(["/files/[slug]"]));
  });

  it("classifies metadata files (opengraph-image, sitemap, etc.)", () => {
    const out = mapFilesToRoutes([
      "app/(app)/files/[slug]/opengraph-image.tsx",
      "app/sitemap.ts",
      "app/robots.ts",
    ]);
    expect(out.every((r) => r.kind === "metadata")).toBe(true);
  });

  it("ignores changes outside app/", () => {
    const out = mapFilesToRoutes([
      "components/print/cart-panel.tsx",
      "lib/db/schema.ts",
      "scripts/sentry-fixer.ts",
      "e2e/library.spec.ts",
      "playwright.config.ts",
    ]);
    expect(out).toEqual([]);
  });

  it("deduplicates when the same file appears twice", () => {
    const out = mapFilesToRoutes([
      "app/(app)/materials/page.tsx",
      "app/(app)/materials/page.tsx",
    ]);
    expect(out).toHaveLength(1);
  });
});

describe("formatRouteImpacts", () => {
  it("renders empty case with guidance about non-route changes", () => {
    const text = formatRouteImpacts([]);
    expect(text).toContain("no app-router files changed");
    expect(text).toContain("grep");
  });

  it("renders impacts as a bulleted markdown list with kind + source", () => {
    const text = formatRouteImpacts([
      {
        path: "/files/[slug]",
        kind: "page",
        source: "app/(app)/files/[slug]/page.tsx",
        affectsSubtree: false,
      },
    ]);
    expect(text).toContain("`/files/[slug]`");
    expect(text).toContain("(page");
    expect(text).toContain("`app/(app)/files/[slug]/page.tsx`");
  });

  it("annotates subtree-affecting changes", () => {
    const text = formatRouteImpacts([
      {
        path: "/",
        kind: "layout",
        source: "app/(app)/layout.tsx",
        affectsSubtree: true,
      },
    ]);
    expect(text).toContain("affects entire subtree");
  });
});
