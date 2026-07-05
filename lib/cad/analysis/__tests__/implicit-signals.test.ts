import { describe, it, expect } from "vitest";

import {
  rollupOutcomes,
  rollupByRouteAndFingerprint,
  pickThreadRoute,
  fingerprintKey,
  type ThreadInput,
  type GenInput,
} from "../implicit-signals";

const byRoute = (t: ThreadInput, g: GenInput[]) => pickThreadRoute(g);

describe("fingerprintKey", () => {
  it("is stable across object key order", () => {
    const a = { v: 1, route: "solid", models: { plan: "x", repair: "y" }, flags: { judge: true, plan: false } };
    const b = { route: "solid", flags: { plan: false, judge: true }, models: { repair: "y", plan: "x" }, v: 1 };
    expect(fingerprintKey(a)).toBe(fingerprintKey(b));
  });

  it("differs when a flag differs", () => {
    const a = { route: "solid", models: {}, flags: { judge: true } };
    const b = { route: "solid", models: {}, flags: { judge: false } };
    expect(fingerprintKey(a)).not.toBe(fingerprintKey(b));
  });

  it("returns 'unknown' for non-objects", () => {
    expect(fingerprintKey(null)).toBe("unknown");
    expect(fingerprintKey("x")).toBe("unknown");
  });
});

describe("rollupOutcomes", () => {
  const threads: ThreadInput[] = [
    { id: "t1", savedFileId: "f1" }, // saved, 3 gens, printed
    { id: "t2", savedFileId: null }, // abandoned after first
    { id: "t3", savedFileId: "f3" }, // saved, 1 gen
  ];
  const gens: GenInput[] = [
    // thread 1: root fail → revise (parent failed) → revise of a success
    { id: "g1", threadId: "t1", status: "failed", route: "solid", fileAssetId: null },
    { id: "g2", threadId: "t1", status: "succeeded", parentGenerationId: "g1", route: "solid", fileAssetId: "a2", aestheticScore: 80 },
    { id: "g3", threadId: "t1", status: "succeeded", parentGenerationId: "g2", route: "solid", fileAssetId: "a3", remeshed: true, aestheticScore: 90 },
    // thread 2: single failed gen, never saved
    { id: "g4", threadId: "t2", status: "failed", route: "generative" },
    // thread 3: single saved gen
    { id: "g5", threadId: "t3", status: "succeeded", route: "solid", fileAssetId: "a5" },
  ];
  const printed = new Set<string>(["a3"]); // t1 printed through

  it("aggregates thread-level outcomes by route", () => {
    const groups = rollupOutcomes(threads, gens, printed, byRoute);
    const solid = groups.get("solid")!;
    expect(solid.threads).toBe(2); // t1, t3
    expect(solid.saved).toBe(2);
    expect(solid.saveRate).toBe(1);
    expect(solid.generations).toBe(4);
    // g3 revises g2 (a succeeded parent) → 1 frustration signal
    expect(solid.reviseAfterSuccess).toBe(1);
    expect(solid.printThroughThreads).toBe(1); // t1 via a3
    expect(solid.printThroughRate).toBe(0.5); // 1 of 2 saved
    expect(solid.avgGenerationsToSave).toBe(2); // (3 + 1) / 2
    expect(solid.remeshRate).toBeCloseTo(1 / 3); // 1 remeshed of 3 succeeded
    expect(solid.avgAesthetic).toBe(85); // (80 + 90) / 2
  });

  it("counts abandoned-after-first for a lone unsaved failure", () => {
    const groups = rollupOutcomes(threads, gens, printed, byRoute);
    const gen = groups.get("generative")!;
    expect(gen.threads).toBe(1);
    expect(gen.abandonedAfterFirst).toBe(1);
    expect(gen.abandonRate).toBe(1);
    expect(gen.saved).toBe(0);
    expect(gen.saveRate).toBe(0);
  });

  it("byRoute and byFingerprint slices both produce groups", () => {
    const gensWithFp: GenInput[] = gens.map((g) => ({
      ...g,
      fingerprint: { route: g.route, models: {}, flags: { judge: true } },
    }));
    const { byRoute: r, byFingerprint: f } = rollupByRouteAndFingerprint(
      threads,
      gensWithFp,
      printed
    );
    expect(r.size).toBe(2); // solid, generative
    expect(f.size).toBeGreaterThanOrEqual(1);
  });
});
