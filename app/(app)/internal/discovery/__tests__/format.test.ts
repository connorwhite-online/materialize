import { describe, expect, it } from "vitest";
import {
  ageInDays,
  fmtAge,
  fmtFactor,
  fmtScore,
  fmtShare,
} from "@/app/(app)/internal/discovery/format";

const now = new Date("2026-08-27T00:00:00Z");
const daysAgo = (days: number) =>
  new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

describe("fmtScore", () => {
  it("renders two decimals and an honest dash for non-finite", () => {
    expect(fmtScore(6.891234)).toBe("6.89");
    expect(fmtScore(0)).toBe("0.00");
    expect(fmtScore(Number.NaN)).toBe("—");
  });
});

describe("fmtFactor", () => {
  it("hides an undiscounted multiplier", () => {
    // The column exists to show what got demoted; a wall of "1.00×"
    // buries the rows that actually were.
    expect(fmtFactor(1)).toBe("—");
    expect(fmtFactor(0.625)).toBe("0.63×");
    expect(fmtFactor(0.25)).toBe("0.25×");
  });
});

describe("ageInDays / fmtAge", () => {
  it("floors to whole days and never goes negative", () => {
    expect(ageInDays(now, now)).toBe(0);
    expect(ageInDays(daysAgo(1.9), now)).toBe(1);
    // A createdAt in the future (clock skew) reads as new, not as -3d.
    expect(ageInDays(new Date(now.getTime() + 3 * 86_400_000), now)).toBe(0);
  });

  it("formats missing dates and long ages", () => {
    expect(fmtAge(null, now)).toBe("—");
    expect(fmtAge(now, now)).toBe("today");
    expect(fmtAge(daysAgo(1), now)).toBe("1d");
    expect(fmtAge(daysAgo(400), now)).toBe("1.1y");
  });
});

describe("fmtShare", () => {
  it("dashes rather than dividing by zero", () => {
    // A row with no downloads and no freshness left scores 0; 0/0 must
    // not print "NaN%" (or a confident, wrong "0%").
    expect(fmtShare(0, 0)).toBe("—");
    expect(fmtShare(1, 4)).toBe("25%");
  });
});
