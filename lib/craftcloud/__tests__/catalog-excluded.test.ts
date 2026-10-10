import { describe, it, expect, vi, afterAll } from "vitest";

// CraftCloud quotes CNC configs for an STL too. Those are dropped on
// purpose, and must be told apart from configs the catalog has never
// seen, or every full quote reports ~7% "missing" options.
const fetchMock = vi.fn();
const originalFetch = global.fetch;
global.fetch = fetchMock as unknown as typeof fetch;
afterAll(() => {
  global.fetch = originalFetch;
});

function material(id: string, technology: string, configId: string) {
  return {
    id,
    name: id,
    slug: id,
    technology,
    materialGroupId: "g1",
    finishGroups: [
      {
        id: `${id}-f`,
        name: "Standard",
        materialConfigs: [
          {
            id: configId,
            name: configId,
            materialId: id,
            materialGroupId: "g1",
            finishGroupId: `${id}-f`,
            color: "white",
            colorCode: "#fff",
          },
        ],
      },
    ],
  };
}

describe("catalog excludedConfigIds", () => {
  it("records non-printing configs as excluded, not as catalog entries", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          materialStructure: [
            {
              id: "g1",
              name: "Mixed",
              materials: [
                material("pla", "3d_printing", "cfg-print"),
                material("alu", "cnc_machining", "cfg-cnc"),
              ],
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );
    vi.resetModules();
    const { getCraftCloudCatalog } = await import("../catalog");
    const catalog = await getCraftCloudCatalog();

    expect(catalog.configById.has("cfg-print")).toBe(true);
    expect(catalog.configById.has("cfg-cnc")).toBe(false);
    expect(catalog.excludedConfigIds?.has("cfg-cnc")).toBe(true);
    expect(catalog.excludedConfigIds?.has("cfg-print")).toBe(false);
  });
});
