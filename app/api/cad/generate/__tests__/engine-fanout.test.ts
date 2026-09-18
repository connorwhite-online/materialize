import { describe, it, expect } from "vitest";

import { allEngines, engineFor } from "@/lib/cad/engines";
// The REAL helper from the route, not a copy of it — a reimplementation here
// would keep passing while the route drifted away from it.
import { resolveEngines } from "../route";

describe("generate route engine resolution", () => {
  it("defaults to brep when nothing is asked for", () => {
    expect(resolveEngines({})).toEqual(["brep"]);
  });

  it("honours a named engine", () => {
    expect(resolveEngines({ engine: "sdf" })).toEqual(["sdf"]);
  });

  it("falls back rather than 400ing on a bogus engine", () => {
    // A stale client must not be able to fail a generation with a typo.
    expect(resolveEngines({ engine: "cadquery" })).toEqual(["brep"]);
    expect(resolveEngines({ engine: 7 })).toEqual(["brep"]);
    expect(resolveEngines({ engine: null })).toEqual(["brep"]);
  });

  it("compare fans out across every engine on the same prompt", () => {
    expect(resolveEngines({ compare: true })).toEqual(["brep", "sdf"]);
  });

  it("compare wins over a named engine", () => {
    // Asking to compare AND naming one engine is contradictory; comparing is
    // the more specific intent and running one arm would silently answer a
    // different question than the one asked.
    expect(resolveEngines({ compare: true, engine: "sdf" })).toEqual([
      "brep",
      "sdf",
    ]);
  });

  it("only the literal true enables compare", () => {
    // Guards against a truthy string from a query param or form body
    // accidentally doubling spend.
    expect(resolveEngines({ compare: "true" })).toEqual(["brep"]);
    expect(resolveEngines({ compare: 1 })).toEqual(["brep"]);
  });

  it("stores each engine under its own name", () => {
    const stored = allEngines().map((e) => engineFor(e.id).storedEngine);
    expect(stored).toEqual(["build123d", "sdf_kit"]);
    expect(new Set(stored).size).toBe(stored.length);
  });
});
