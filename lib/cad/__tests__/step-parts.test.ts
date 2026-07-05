import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resolveLocalFastener } from "@/lib/cad/step-parts/local-fasteners";
import {
  sourcePart,
  sourcePartsForBrief,
  formatSourcedPartsForPrompt,
} from "@/lib/cad/step-parts";
import {
  searchParts,
  downloadAndCacheStep,
  StepPartsNetworkError,
} from "@/lib/cad/step-parts/client";

// Mock only the NETWORK surface of the client; keep the real StepPartsNetworkError
// (index.ts branches on `instanceof`) and let catalogEnabled read the env so a
// single test file can exercise both the gated-off default and the enabled path.
vi.mock("@/lib/cad/step-parts/client", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/cad/step-parts/client")>();
  return {
    ...actual,
    catalogEnabled: () => process.env.CAD_STEP_PARTS_ENABLED === "true",
    searchParts: vi.fn(),
    downloadAndCacheStep: vi.fn(),
  };
});

const mockedSearch = vi.mocked(searchParts);
const mockedDownload = vi.mocked(downloadAndCacheStep);

beforeEach(() => {
  delete process.env.CAD_STEP_PARTS_ENABLED;
  mockedSearch.mockReset();
  mockedDownload.mockReset();
});
afterEach(() => {
  delete process.env.CAD_STEP_PARTS_ENABLED;
});

describe("resolveLocalFastener", () => {
  it("resolves a fully-specified screw with an envelope", () => {
    const p = resolveLocalFastener("iso4762 socket head cap screw M3x12");
    expect(p).not.toBeNull();
    expect(p!.kind).toBe("local-fastener");
    expect(p!.label).toMatch(/M3×12 socket head cap screw/);
    // [head dia, head dia, head height + length] = [5.5, 5.5, 3 + 12]
    expect(p!.envelopeMm).toEqual([5.5, 5.5, 15]);
  });

  it("resolves an M3x12 with no family word (length implies a screw)", () => {
    const p = resolveLocalFastener("M3x12");
    expect(p).not.toBeNull();
    expect(p!.envelopeMm![2]).toBeCloseTo(15, 5);
  });

  it("gives a nut a short, shank-less envelope", () => {
    const p = resolveLocalFastener("M4 hex nut");
    expect(p).not.toBeNull();
    expect(p!.label).toMatch(/hex nut/);
    // no shank length → height is small, not head+length
    expect(p!.envelopeMm![2]).toBeLessThan(6);
  });

  it("does not resolve a bare size with no family or length (too ambiguous)", () => {
    expect(resolveLocalFastener("M3")).toBeNull();
  });

  it("does not resolve a non-fastener component", () => {
    expect(resolveLocalFastener("raspberry pi pico")).toBeNull();
  });
});

describe("sourcePart — catalog disabled (default: local library only)", () => {
  it("resolves a fastener locally without touching the network", async () => {
    const res = await sourcePart("M3x12 socket head cap screw");
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.part.kind).toBe("local-fastener");
    expect(mockedSearch).not.toHaveBeenCalled();
  });

  it("records a no-match miss for a non-fastener (envelope fallback applies)", async () => {
    const res = await sourcePart("raspberry pi pico");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.miss.reason).toBe("no-match");
  });
});

describe("sourcePart — catalog enabled", () => {
  beforeEach(() => {
    process.env.CAD_STEP_PARTS_ENABLED = "true";
  });

  it("returns real vendor STEP (cached + sha-verified) on a catalog hit", async () => {
    mockedSearch.mockResolvedValueOnce([
      { id: "pico", name: "Raspberry Pi Pico", sha256: "aa", byteSize: 5, stepUrl: "https://x/pico.step" },
    ]);
    mockedDownload.mockResolvedValueOnce({
      cacheKey: "cad-parts/step-parts/pico/aa.step",
      sha256: "aa",
      byteSize: 5,
      fromCache: false,
    });
    const res = await sourcePart("raspberry pi pico");
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.part.kind).toBe("catalog");
      expect(res.part.cacheKey).toBe("cad-parts/step-parts/pico/aa.step");
      expect(res.part.sha256).toBe("aa");
    }
  });

  it("records a network-error miss (NOT no-match) when the catalog is unreachable", async () => {
    mockedSearch.mockRejectedValueOnce(new StepPartsNetworkError("down"));
    const res = await sourcePart("raspberry pi pico");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.miss.reason).toBe("network-error");
  });

  it("falls back to the local library when the catalog is unreachable but a fastener matches", async () => {
    mockedSearch.mockRejectedValueOnce(new StepPartsNetworkError("down"));
    const res = await sourcePart("M3x12 cap screw");
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.part.kind).toBe("local-fastener");
  });

  it("records a checksum-mismatch miss when the STEP fails verification", async () => {
    mockedSearch.mockResolvedValueOnce([
      { id: "bearing608", sha256: "aa", byteSize: 5, stepUrl: "https://x/608.step" },
    ]);
    const bad = new Error("mismatch");
    bad.name = "StepPartsChecksumError";
    mockedDownload.mockRejectedValueOnce(bad);
    const res = await sourcePart("608 bearing");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.miss.reason).toBe("checksum-mismatch");
  });
});

describe("sourcePartsForBrief + prompt formatting", () => {
  it("sources components + screw interfaces and formats a prompt block", async () => {
    const brief = {
      components: [{ name: "M3x12 socket head cap screw" }, { name: "raspberry pi pico" }],
      interfaces: [{ type: "mount", std: "M4 hex nut" }],
    };
    const s = await sourcePartsForBrief(brief);
    expect(s.sourced.some((p) => p.kind === "local-fastener")).toBe(true);
    // the pico has no local match and the catalog is off → recorded as a miss
    expect(s.misses.some((m) => m.query === "raspberry pi pico")).toBe(true);

    const block = formatSourcedPartsForPrompt(s);
    expect(block).toMatch(/Off-the-shelf parts/);
    expect(block).toMatch(/documented envelope/);
  });

  it("formats nothing when there is nothing to say", () => {
    expect(formatSourcedPartsForPrompt({ sourced: [], misses: [] })).toBe("");
  });
});
