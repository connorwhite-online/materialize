import { describe, it, expect } from "vitest";
import { matchCraftCloudMaterialId } from "../craftcloud-resolver";

// Synthetic stand-in for the live CraftCloud catalog's material list,
// using realistic names. The resolver matches by name tokens, so this
// exercises the matching logic without a network round-trip.
const CATALOG = [
  { id: "uuid-pla", name: "PLA" },
  { id: "uuid-abs", name: "ABS" },
  { id: "uuid-sls-pa12", name: "SLS Nylon PA12" },
  { id: "uuid-mjf-pa12", name: "HP MJF Nylon PA12" },
  { id: "uuid-pa11", name: "SLS Nylon PA11" },
  { id: "uuid-std-resin", name: "Standard Resin" },
  { id: "uuid-tough-resin", name: "Tough Resin" },
  { id: "uuid-tpu", name: "TPU" },
  { id: "uuid-316l", name: "316L Stainless Steel" },
  { id: "uuid-alu", name: "Aluminum (AlSi10Mg)" },
  { id: "uuid-ti", name: "Titanium Ti6Al4V" },
  { id: "uuid-petg", name: "PETG" },
  { id: "uuid-asa", name: "ASA" },
  { id: "uuid-pc", name: "Polycarbonate" },
];

describe("matchCraftCloudMaterialId", () => {
  it("maps simple presets to their CraftCloud material", () => {
    expect(matchCraftCloudMaterialId("pla-white", CATALOG)).toBe("uuid-pla");
    expect(matchCraftCloudMaterialId("pla-black", CATALOG)).toBe("uuid-pla");
    expect(matchCraftCloudMaterialId("abs-white", CATALOG)).toBe("uuid-abs");
    expect(matchCraftCloudMaterialId("petg", CATALOG)).toBe("uuid-petg");
    expect(matchCraftCloudMaterialId("titanium", CATALOG)).toBe("uuid-ti");
    expect(matchCraftCloudMaterialId("steel-316l", CATALOG)).toBe("uuid-316l");
  });

  it("matches the Aluminium spelling variant", () => {
    const alt = [{ id: "uuid-alu-uk", name: "Aluminium (AlSi10Mg)" }];
    expect(matchCraftCloudMaterialId("aluminum", alt)).toBe("uuid-alu-uk");
  });

  it("prefers SLS over HP MJF for the SLS Nylon PA12 preset", () => {
    expect(matchCraftCloudMaterialId("nylon-pa12", CATALOG)).toBe("uuid-sls-pa12");
    expect(matchCraftCloudMaterialId("nylon-pa12-black", CATALOG)).toBe(
      "uuid-sls-pa12"
    );
  });

  it("disambiguates resin grades via the prefer token", () => {
    expect(matchCraftCloudMaterialId("resin-standard", CATALOG)).toBe(
      "uuid-std-resin"
    );
    expect(matchCraftCloudMaterialId("resin-tough", CATALOG)).toBe(
      "uuid-tough-resin"
    );
  });

  it("returns null for an unknown preset id", () => {
    expect(matchCraftCloudMaterialId("not-a-real-id", CATALOG)).toBeNull();
  });

  it("returns null when the catalog has no matching material", () => {
    // Catalog without any PLA material.
    const noPla = CATALOG.filter((m) => !m.name.toLowerCase().includes("pla"));
    expect(matchCraftCloudMaterialId("pla-white", noPla)).toBeNull();
  });

  it("falls back to the first allOf match when the prefer token is absent", () => {
    // Only HP MJF available — no 'sls' to prefer, so take what matches.
    const onlyMjf = [{ id: "uuid-mjf", name: "HP MJF Nylon PA12" }];
    expect(matchCraftCloudMaterialId("nylon-pa12", onlyMjf)).toBe("uuid-mjf");
  });
});
