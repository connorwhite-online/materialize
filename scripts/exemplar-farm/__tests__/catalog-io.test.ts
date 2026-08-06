import { describe, expect, it } from "vitest";

import type { CadExemplar } from "@/lib/cad/knowledge/exemplars";
import {
  authoredCollisions,
  serializeFarmedCatalog,
  upsertFarmed,
} from "../catalog-io";

const entry = (id: string, code = "result = 1"): CadExemplar => ({
  id,
  title: `T ${id}`,
  keywords: ["k"],
  lesson: "l",
  code,
  verified: true,
});

describe("authoredCollisions", () => {
  it("flags farmed ids that shadow authored ones", () => {
    expect(
      authoredCollisions([{ id: "farm_x" }, { id: "rounded_enclosure" }], [
        "rounded_enclosure",
      ])
    ).toEqual(["rounded_enclosure"]);
    expect(authoredCollisions([{ id: "farm_x" }], ["rounded_enclosure"])).toEqual(
      []
    );
  });
});

describe("upsertFarmed", () => {
  it("replaces by id and appends new entries", () => {
    const next = upsertFarmed(
      [entry("farm_a", "old")],
      [entry("farm_a", "new"), entry("farm_b")]
    );
    expect(next.map((e) => e.id)).toEqual(["farm_a", "farm_b"]);
    expect(next[0].code).toBe("new");
  });
});

describe("serializeFarmedCatalog", () => {
  it("round-trips code with quotes, backticks, and newlines", async () => {
    const nasty = 'r = "a"\n# `tick` and ${interp} and \\ backslash\nresult = r';
    const src = serializeFarmedCatalog([entry("farm_nasty", nasty)]);
    // The generated module must parse as valid TS and reproduce the code
    // byte-for-byte — evaluate the array literal portion via JSON-safe eval.
    const match = src.match(/FARMED_EXEMPLARS: CadExemplar\[\] = (\[[\s\S]*\]);/);
    expect(match).toBeTruthy();
    // eslint-disable-next-line no-eval
    const parsed = (0, eval)(`(${match![1]})`) as CadExemplar[];
    expect(parsed).toHaveLength(1);
    expect(parsed[0].code).toBe(nasty);
    expect(parsed[0].verified).toBe(true);
  });

  it("keeps an empty catalog importable", () => {
    const src = serializeFarmedCatalog([]);
    expect(src).toContain("FARMED_EXEMPLARS: CadExemplar[] = [");
    expect(src).toContain("import type { CadExemplar }");
  });
});
