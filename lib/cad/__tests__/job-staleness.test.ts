import { describe, expect, it } from "vitest";
import {
  STALE_RUNNING_MS,
  isStaleCadJob,
} from "@/lib/cad/job-staleness";

describe("isStaleCadJob", () => {
  it("is false when the job is younger than the bound", () => {
    const now = 1_000_000;
    expect(isStaleCadJob(new Date(now - 5 * 60_000), now)).toBe(false);
  });

  it("is true just past the bound (covers a dead after() past maxDuration=300s)", () => {
    const now = 1_000_000;
    expect(isStaleCadJob(new Date(now - STALE_RUNNING_MS - 1), now)).toBe(true);
  });

  it("is false for a missing birth timestamp", () => {
    expect(isStaleCadJob(null)).toBe(false);
    expect(isStaleCadJob(undefined)).toBe(false);
  });

  it("sits between generate maxDuration (300s) and the old 10-minute ghost window", () => {
    expect(STALE_RUNNING_MS).toBeGreaterThan(300_000);
    expect(STALE_RUNNING_MS).toBeLessThan(10 * 60_000);
  });
});
