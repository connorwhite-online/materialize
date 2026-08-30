import { describe, it, expect } from "vitest";
import { selectMockCatalogConfigIds } from "../mock";

function material(
  sortIndex: number,
  finishes: Array<Array<{ id: string; color: string }>>
) {
  return {
    sortIndex,
    finishGroups: finishes.map((materialConfigs) => ({ materialConfigs })),
  };
}

describe("selectMockCatalogConfigIds", () => {
  it("prefers low sortIndex materials and one config per color per finish", () => {
    const catalog = {
      materialById: new Map([
        [
          "late",
          material(50, [[{ id: "late-a", color: "White" }]]),
        ],
        [
          "pla",
          material(1, [
            [
              { id: "std-white", color: "White" },
              { id: "std-white-2", color: "White" },
              { id: "std-black", color: "Black" },
            ],
            [
              { id: "pol-white", color: "White" },
              { id: "pol-red", color: "Red" },
            ],
          ]),
        ],
      ]),
    };

    expect(selectMockCatalogConfigIds(catalog)).toEqual([
      "std-white",
      "std-black",
      "pol-white",
      "pol-red",
      "late-a",
    ]);
  });

  it("returns an empty list when the catalog has no configs", () => {
    expect(
      selectMockCatalogConfigIds({ materialById: new Map() })
    ).toEqual([]);
  });
});
