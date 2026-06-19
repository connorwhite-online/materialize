import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";

// CraftCloud's customer-api edge intermittently 403/429-challenges
// datacenter IPs (most visibly during `next build`). The catalog
// fetch should retry transient challenges and only throw on a
// persistent failure. We mock global fetch and re-import the module
// per test because catalog.ts memoizes the parsed catalog/providers
// at module scope.
const fetchMock = vi.fn();
const originalFetch = global.fetch;
global.fetch = fetchMock as unknown as typeof fetch;

afterAll(() => {
  global.fetch = originalFetch;
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function statusResponse(status: number): Response {
  return new Response("blocked", { status });
}

async function freshModule() {
  vi.resetModules();
  return import("../catalog");
}

describe("catalog fetch retry", () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });

  it("retries a transient 403 challenge then succeeds", async () => {
    fetchMock
      .mockResolvedValueOnce(statusResponse(403))
      .mockResolvedValueOnce(jsonResponse([{ vendorId: "v1", name: "Vendor One" }]));

    const { getProviderIndex } = await freshModule();
    const providers = await getProviderIndex();

    expect(providers.get("v1")?.name).toBe("Vendor One");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("throws with the upstream status after exhausting retries", async () => {
    fetchMock.mockResolvedValue(statusResponse(403));

    const { getProviderIndex } = await freshModule();
    await expect(getProviderIndex()).rejects.toThrow("provider fetch failed: 403");
    // 3 attempts total (1 + 2 retries).
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("does not retry a non-transient status (e.g. 404)", async () => {
    fetchMock.mockResolvedValue(statusResponse(404));

    const { getProviderIndex } = await freshModule();
    await expect(getProviderIndex()).rejects.toThrow("provider fetch failed: 404");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("builds the catalog index on a first-try success without retrying", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        materialStructure: [
          {
            id: "g1",
            name: "Plastics",
            materials: [
              {
                id: "m1",
                name: "PLA",
                slug: "pla",
                technology: "3d_printing",
                materialGroupId: "g1",
                finishGroups: [
                  {
                    id: "f1",
                    name: "Standard",
                    materialConfigs: [
                      {
                        id: "c1",
                        name: "PLA White",
                        materialId: "m1",
                        materialGroupId: "g1",
                        finishGroupId: "f1",
                        color: "white",
                        colorCode: "#fff",
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      })
    );

    const { getCraftCloudCatalog } = await freshModule();
    const catalog = await getCraftCloudCatalog();

    expect(catalog.groups).toHaveLength(1);
    expect(catalog.configById.get("c1")?.material.name).toBe("PLA");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
