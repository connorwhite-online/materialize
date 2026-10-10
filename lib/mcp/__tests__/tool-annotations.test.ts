import { describe, expect, it } from "vitest";
import { TOOL_ANNOTATIONS } from "../tool-annotations";

/**
 * Anthropic's connector directory rejects tool names over 64 characters
 * and flags tools whose read/write hints aren't explicit; the portal
 * sorts tools into read and write groups from them.
 */
describe("TOOL_ANNOTATIONS — directory requirements", () => {
  it.each(Object.entries(TOOL_ANNOTATIONS))("%s", (name, a) => {
    expect(name.length).toBeLessThanOrEqual(64);
    expect(typeof a.readOnlyHint).toBe("boolean");
    expect(typeof a.destructiveHint).toBe("boolean");
    // A read-only tool can't also be destructive.
    if (a.readOnlyHint) expect(a.destructiveHint).toBe(false);
  });
});
