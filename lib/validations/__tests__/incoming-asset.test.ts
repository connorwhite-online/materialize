import { describe, it, expect } from "vitest";
import { isIncomingAsset } from "../incoming-asset";

describe("isIncomingAsset", () => {
  const validAsset = {
    storageKey: "uploads/user-1/abc/test.stl",
    originalFilename: "test.stl",
    format: "stl",
    fileSize: 1024,
  };

  it("accepts a minimal valid asset", () => {
    expect(isIncomingAsset(validAsset)).toBe(true);
  });

  it("accepts an asset with optional fileUnit", () => {
    expect(isIncomingAsset({ ...validAsset, fileUnit: "mm" })).toBe(true);
    expect(isIncomingAsset({ ...validAsset, fileUnit: "cm" })).toBe(true);
    expect(isIncomingAsset({ ...validAsset, fileUnit: "in" })).toBe(true);
  });

  it("accepts all supported formats", () => {
    for (const format of ["stl", "obj", "3mf", "step", "amf"]) {
      expect(isIncomingAsset({ ...validAsset, format })).toBe(true);
    }
  });

  it("rejects null, non-objects, and arrays without the right shape", () => {
    expect(isIncomingAsset(null)).toBe(false);
    expect(isIncomingAsset(undefined)).toBe(false);
    expect(isIncomingAsset("string")).toBe(false);
    expect(isIncomingAsset(42)).toBe(false);
    // Arrays pass typeof === "object" but fail the field checks.
    expect(isIncomingAsset([])).toBe(false);
    expect(isIncomingAsset({})).toBe(false);
  });

  it("rejects empty storageKey", () => {
    expect(isIncomingAsset({ ...validAsset, storageKey: "" })).toBe(false);
  });

  it("rejects missing storageKey", () => {
    const { storageKey: _, ...rest } = validAsset;
    expect(isIncomingAsset(rest)).toBe(false);
  });

  it("rejects unsupported format", () => {
    expect(isIncomingAsset({ ...validAsset, format: "fbx" })).toBe(false);
    expect(isIncomingAsset({ ...validAsset, format: "gltf" })).toBe(false);
    expect(isIncomingAsset({ ...validAsset, format: "STL" })).toBe(false);
  });

  it("rejects zero or negative fileSize", () => {
    expect(isIncomingAsset({ ...validAsset, fileSize: 0 })).toBe(false);
    expect(isIncomingAsset({ ...validAsset, fileSize: -1 })).toBe(false);
  });

  it("rejects non-finite fileSize", () => {
    expect(isIncomingAsset({ ...validAsset, fileSize: NaN })).toBe(false);
    expect(isIncomingAsset({ ...validAsset, fileSize: Infinity })).toBe(false);
  });

  it("rejects non-number fileSize", () => {
    expect(isIncomingAsset({ ...validAsset, fileSize: "1024" })).toBe(false);
  });

  it("rejects unsupported fileUnit", () => {
    expect(isIncomingAsset({ ...validAsset, fileUnit: "meter" })).toBe(false);
    expect(isIncomingAsset({ ...validAsset, fileUnit: "mm " })).toBe(false);
  });

  it("rejects empty originalFilename", () => {
    expect(isIncomingAsset({ ...validAsset, originalFilename: "" })).toBe(
      false
    );
  });
});
