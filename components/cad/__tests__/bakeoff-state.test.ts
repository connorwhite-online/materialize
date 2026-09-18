import { describe, it, expect } from "vitest";

import {
  bakeoffVerdict,
  elapsedMs,
  initialPane,
  reduceBakeoffEvent,
  type BakeoffPane,
} from "../bakeoff-state";
import type { CadStreamEvent } from "@/lib/cad/types";

function pane(over: Partial<BakeoffPane> = {}): BakeoffPane {
  return {
    ...initialPane({ engine: "sdf", generationId: "g", jobId: "j" }),
    ...over,
  };
}

const doneEvent = {
  type: "done",
  generationId: "g",
  fileAssetId: "fa",
  fileSlug: "slug",
  renderUrl: "https://r2/render.png",
  sourceCode: "result = 1",
  title: null,
} satisfies CadStreamEvent;

describe("bakeoff pane reduction", () => {
  it("tracks phase and attempts while running", () => {
    const p = reduceBakeoffEvent(pane(), {
      type: "phase",
      phase: "executing",
      attempt: 2,
      maxAttempts: 4,
    });
    expect(p).toMatchObject({
      status: "running",
      phase: "executing",
      attempt: 2,
      maxAttempts: 4,
    });
  });

  it("lands on done with the render and stamps the finish time", () => {
    const p = reduceBakeoffEvent(pane({ startedAt: 1000 }), doneEvent, 4000);
    expect(p.status).toBe("done");
    expect(p.renderUrl).toBe("https://r2/render.png");
    expect(elapsedMs(p)).toBe(3000);
  });

  it("treats a terminal state as sticky", () => {
    // The events route replays persisted progress and re-emits the last
    // snapshot on reconnect, so a late snapshot after `done` is normal.
    // Letting it flip the pane back to running would lose the result AND
    // corrupt the elapsed time the whole comparison rests on.
    const finished = reduceBakeoffEvent(pane({ startedAt: 0 }), doneEvent, 5000);
    const after = reduceBakeoffEvent(
      finished,
      { type: "snapshot", png: "late", step: 9 } as unknown as CadStreamEvent,
      9999
    );
    expect(after).toBe(finished);
    expect(elapsedMs(after)).toBe(5000);
  });

  it("ignores events it has no opinion about", () => {
    // The stream carries references/usage/question events; a bake-off pane
    // must not fall over on one.
    const p = pane();
    for (const e of [
      { type: "usage", usage: {} },
      { type: "references", count: 2 },
      { type: "route", route: "engine-sdf" },
    ] as unknown as CadStreamEvent[]) {
      expect(reduceBakeoffEvent(p, e)).toBe(p);
    }
  });

  it("records an error as terminal", () => {
    const p = reduceBakeoffEvent(
      pane({ startedAt: 0 }),
      { type: "error", error: "not watertight" },
      2000
    );
    expect(p).toMatchObject({ status: "error", error: "not watertight" });
    expect(elapsedMs(p)).toBe(2000);
  });
});

describe("bakeoff verdict", () => {
  it("withholds a verdict until BOTH arms land", () => {
    // Calling it early would just report which engine finished first, which
    // is precisely backwards when the slower engine is the one that works.
    const v = bakeoffVerdict([
      pane({ engine: "brep", status: "done", startedAt: 0, finishedAt: 10 }),
      pane({ engine: "sdf", status: "running" }),
    ]);
    expect(v).toMatchObject({ settled: false, winner: null });
  });

  it("names the only engine that produced a mesh", () => {
    const v = bakeoffVerdict([
      pane({ engine: "brep", status: "error", startedAt: 0, finishedAt: 10 }),
      pane({ engine: "sdf", status: "done", startedAt: 0, finishedAt: 900 }),
    ]);
    expect(v).toMatchObject({ settled: true, winner: "sdf" });
  });

  it("reports both failing rather than inventing a winner", () => {
    const v = bakeoffVerdict([
      pane({ engine: "brep", status: "error", startedAt: 0, finishedAt: 5 }),
      pane({ engine: "sdf", status: "error", startedAt: 0, finishedAt: 5 }),
    ]);
    expect(v).toMatchObject({ settled: true, winner: null, reason: "both failed" });
  });

  it("tiebreaks on time but says that is all it measured", () => {
    const v = bakeoffVerdict([
      pane({ engine: "brep", status: "done", startedAt: 0, finishedAt: 9000 }),
      pane({ engine: "sdf", status: "done", startedAt: 0, finishedAt: 3000 }),
    ]);
    expect(v.winner).toBe("sdf");
    // A faster ugly part is not the better part, and the copy must not
    // pretend the machine judged quality.
    expect(v.reason).toMatch(/judge quality yourself/);
  });
});
