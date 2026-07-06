import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resolveStandardPart } from "@/lib/cad/step-parts/bd-warehouse";
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

describe("resolveStandardPart — bd_warehouse constructor snippets", () => {
  it("resolves a fully-specified screw to a SocketHeadCapScrew constructor", () => {
    const p = resolveStandardPart("iso4762 socket head cap screw M3x12");
    expect(p).not.toBeNull();
    expect(p!.kind).toBe("bd_warehouse");
    expect(p!.label).toMatch(/M3×12 socket head cap screw/);
    expect(p!.bdWarehouse).toEqual({
      importLine: "from bd_warehouse.fastener import SocketHeadCapScrew",
      constructor: 'SocketHeadCapScrew(size="M3-0.5", length=12, fastener_type="iso4762")',
    });
    // Envelope rides along for no-exec sizing: [head dia, head dia, head + length]
    expect(p!.envelopeMm).toEqual([5.5, 5.5, 15]);
  });

  it("resolves the shcs alias and the underscore standard-code form identically", () => {
    const alias = resolveStandardPart("m3x12 shcs");
    const code = resolveStandardPart("iso4762_m3x12");
    expect(alias?.bdWarehouse?.constructor).toBe(
      'SocketHeadCapScrew(size="M3-0.5", length=12, fastener_type="iso4762")'
    );
    expect(code?.bdWarehouse?.constructor).toBe(alias?.bdWarehouse?.constructor);
  });

  it("resolves an M3x12 with no family word as an SHCS (length implies a screw)", () => {
    const p = resolveStandardPart("M3x12");
    expect(p).not.toBeNull();
    expect(p!.bdWarehouse?.constructor).toMatch(/^SocketHeadCapScrew/);
    expect(p!.envelopeMm![2]).toBeCloseTo(15, 5);
  });

  it("assumes 10 mm and says so when a screw length is missing", () => {
    const p = resolveStandardPart("M4 countersunk screw");
    expect(p!.bdWarehouse?.constructor).toBe(
      'CounterSunkScrew(size="M4-0.7", length=10, fastener_type="iso10642")'
    );
    expect(p!.note).toMatch(/10 mm assumed/);
  });

  it("resolves a hex nut (shank-less envelope) and a washer with size-only string", () => {
    const nut = resolveStandardPart("M4 hex nut");
    expect(nut!.bdWarehouse?.constructor).toBe('HexNut(size="M4-0.7", fastener_type="iso4032")');
    expect(nut!.envelopeMm![2]).toBeLessThan(6);

    // Washer tables key by nominal size only ("M3"), not size-pitch.
    const washer = resolveStandardPart("M3 washer");
    expect(washer!.bdWarehouse?.constructor).toBe(
      'PlainWasher(size="M3", fastener_type="iso7089")'
    );
  });

  it("keeps the set-screw table's trailing-decimal pitch quirk (M6-1.0)", () => {
    const p = resolveStandardPart("M6x8 grub screw");
    expect(p!.bdWarehouse?.constructor).toBe(
      'SetScrew(size="M6-1.0", length=8, fastener_type="iso4026")'
    );
  });

  it("resolves an M3 heat-set insert to HeatSetNut and keeps our boss recipe", () => {
    const p = resolveStandardPart("M3 heat-set insert");
    expect(p!.kind).toBe("bd_warehouse");
    expect(p!.bdWarehouse?.constructor).toBe(
      'HeatSetNut(size="M3-0.5-Standard", fastener_type="McMaster-Carr")'
    );
    // The printed BOSS around the insert stays our recipe, not bd_warehouse's.
    expect(p!.note).toMatch(/bore 4 mm/);
    expect(p!.note).toMatch(/>=2 mm wall/);
  });

  it("falls back to envelope-only for heat-set sizes bd_warehouse does not table (M8)", () => {
    const p = resolveStandardPart("M8 threaded insert");
    expect(p).not.toBeNull();
    expect(p!.kind).toBe("local-fastener");
    expect(p!.bdWarehouse).toBeUndefined();
    expect(p!.note).toMatch(/M2-M5 only/);
    expect(p!.envelopeMm).toBeDefined();
  });

  it("falls back to envelope-only for button-head sizes missing from the table (M2)", () => {
    const p = resolveStandardPart("M2x6 button head screw");
    expect(p!.kind).toBe("local-fastener");
    expect(p!.bdWarehouse).toBeUndefined();
    expect(p!.note).toMatch(/no M2/);
  });

  it("resolves 608zz to the capped deep-groove bearing constructor", () => {
    const p = resolveStandardPart("608zz");
    expect(p).not.toBeNull();
    expect(p!.kind).toBe("bd_warehouse");
    expect(p!.label).toMatch(/608ZZ/);
    expect(p!.envelopeMm).toEqual([22, 22, 7]);
    expect(p!.bdWarehouse).toEqual({
      importLine: "from bd_warehouse.bearing import SingleRowCappedDeepGrooveBallBearing",
      constructor: 'SingleRowCappedDeepGrooveBallBearing(size="M8-22-7", bearing_type="SKT")',
    });
  });

  it("resolves an open bearing by designation + the word bearing", () => {
    const p = resolveStandardPart("625 bearing");
    expect(p!.bdWarehouse?.constructor).toBe(
      'SingleRowDeepGrooveBallBearing(size="M5-16-5", bearing_type="SKT")'
    );
    expect(p!.envelopeMm).toEqual([16, 16, 5]);
  });

  it("models the open bearing (same envelope, honest note) when a capped size is not tabled", () => {
    const p = resolveStandardPart("6000-2RS bearing");
    expect(p!.bdWarehouse?.constructor).toBe(
      'SingleRowDeepGrooveBallBearing(size="M10-26-8", bearing_type="SKT")'
    );
    expect(p!.note).toMatch(/Capped variant not tabled/);
  });

  it("does not resolve ambiguous or non-standard queries", () => {
    expect(resolveStandardPart("M3")).toBeNull(); // bare size, no family/length
    expect(resolveStandardPart("625")).toBeNull(); // bare number, no bearing signal
    expect(resolveStandardPart("raspberry pi pico")).toBeNull();
  });
});

describe("sourcePart — catalog disabled (default: bd_warehouse resolver only)", () => {
  it("resolves a fastener without touching the network", async () => {
    const res = await sourcePart("M3x12 socket head cap screw");
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.part.kind).toBe("bd_warehouse");
    expect(mockedSearch).not.toHaveBeenCalled();
  });

  it("records a no-match miss for a non-standard part (envelope fallback applies)", async () => {
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

  it("falls back to bd_warehouse when the catalog is unreachable but a fastener matches", async () => {
    mockedSearch.mockRejectedValueOnce(new StepPartsNetworkError("down"));
    const res = await sourcePart("M3x12 cap screw");
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.part.kind).toBe("bd_warehouse");
  });

  it("records a checksum-mismatch miss when the STEP fails verification", async () => {
    mockedSearch.mockResolvedValueOnce([
      { id: "pico-board", sha256: "aa", byteSize: 5, stepUrl: "https://x/pico.step" },
    ]);
    const bad = new Error("mismatch");
    bad.name = "StepPartsChecksumError";
    mockedDownload.mockRejectedValueOnce(bad);
    const res = await sourcePart("pico board");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.miss.reason).toBe("checksum-mismatch");
  });
});

describe("sourcePartsForBrief + prompt formatting", () => {
  it("sources components + screw interfaces and formats constructor snippets", async () => {
    const brief = {
      components: [{ name: "M3x12 socket head cap screw" }, { name: "raspberry pi pico" }],
      interfaces: [{ type: "mount", std: "M4 hex nut" }],
    };
    const s = await sourcePartsForBrief(brief);
    expect(s.sourced.some((p) => p.kind === "bd_warehouse")).toBe(true);
    // the pico has no standard-parts match and the catalog is off → a miss
    expect(s.misses.some((m) => m.query === "raspberry pi pico")).toBe(true);

    const block = formatSourcedPartsForPrompt(s);
    expect(block).toMatch(/Off-the-shelf parts/);
    expect(block).toMatch(/never hand-model it/);
    expect(block).toMatch(/SocketHeadCapScrew\(size="M3-0\.5", length=12/);
    expect(block).toMatch(/from bd_warehouse\.fastener import HexNut/);
    expect(block).toMatch(/documented envelope/);
  });

  it("formats nothing when there is nothing to say", () => {
    expect(formatSourcedPartsForPrompt({ sourced: [], misses: [] })).toBe("");
  });
});
