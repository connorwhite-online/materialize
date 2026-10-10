import { describe, it, expect } from "vitest";
import { invalidJsonResponse, readJsonObject } from "../json-body";

function req(body: string) {
  return new Request("http://localhost/x", { method: "POST", body });
}

describe("readJsonObject", () => {
  it("returns a parsed object", async () => {
    expect(await readJsonObject(req('{"a":1}'))).toEqual({ a: 1 });
  });

  it.each([["not json"], [""], ["null"], ["[1,2]"], ['"str"'], ["42"]])(
    "returns null for %j",
    async (body) => {
      expect(await readJsonObject(req(body))).toBeNull();
    }
  );
});

describe("invalidJsonResponse", () => {
  it("is a 400", async () => {
    const res = invalidJsonResponse();
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid JSON body" });
  });
});
