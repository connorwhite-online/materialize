import { describe, it, expect, vi, beforeEach } from "vitest";
import type { CadRunResult } from "@/lib/cad/types";

// Same mocking shape as harness.test.ts: no credentials, so the harness stays
// on its deterministic fallback and we can assert purely on what it asks the
// sidecar for.
const hasModelCredentials = vi.fn(() => false);
const completeText = vi.fn(async () => "```python\nresult = 1\n```");

vi.mock("@/lib/cad/model-client", () => ({
  hasModelCredentials: () => hasModelCredentials(),
  completeText: (...args: unknown[]) =>
    completeText(...(args as Parameters<typeof completeText>)),
}));

const runCadCode = vi.fn<
  (
    code: string,
    formats?: string[],
    signal?: AbortSignal,
    opts?: { engine?: string; allowRemesh?: boolean }
  ) => Promise<CadRunResult>
>();

vi.mock("@/lib/cad/runner-client", () => ({
  runCadCode: (...args: Parameters<typeof runCadCode>) => runCadCode(...args),
}));

import { runHarness } from "@/lib/cad/harness";

function okRun(): CadRunResult {
  return {
    ok: true,
    files: { stl: "" },
    validation: {
      compiled: true,
      isSolid: true,
      isWatertight: true,
      isManifold: true,
    },
  };
}

describe("harness engine selection", () => {
  beforeEach(() => {
    hasModelCredentials.mockReset().mockReturnValue(false);
    completeText.mockReset().mockResolvedValue("```python\nresult = 1\n```");
    runCadCode.mockReset().mockResolvedValue(okRun());
  });

  it("defaults to build123d with the B-rep formats", async () => {
    await runHarness({ prompt: "a 20mm cube", maxAttempts: 1 });
    const [, formats, , opts] = runCadCode.mock.calls[0];
    expect(formats).toEqual(["stl", "step", "topo"]);
    // The one intentional wire change from the registry: the B-rep path used
    // to omit `engine` and let the sidecar default it, and now sends it
    // explicitly. The sidecar treats absent and "build123d" identically
    // (cad-runner/README.md: `engine` defaults to build123d), so this is a
    // wire difference, not a behaviour one — worth pinning so it stays a
    // deliberate choice rather than an accident.
    expect(opts?.engine).toBe("build123d");
  });

  it("runs the sdf engine on the sidecar's mesh path with stl only", async () => {
    await runHarness({ prompt: "a 20mm cube", maxAttempts: 1, engine: "sdf" });
    const [code, formats, , opts] = runCadCode.mock.calls[0];
    expect(opts?.engine).toBe("mesh");
    // No B-rep to export from, so asking for step/topo would be a lie.
    expect(formats).toEqual(["stl"]);
    // The credential-free fallback must speak the engine's dialect — the
    // sidecar's mesh engine rejects a non-trimesh `result` outright, so
    // emitting build123d here would fail every SDF run for the wrong reason.
    expect(code).toMatch(/from sdf_kit import/);
    expect(code).toMatch(/to_mesh\(/);
    expect(code).not.toMatch(/from build123d import/);
  });

  it("keeps the build123d fallback for the default engine", async () => {
    await runHarness({ prompt: "a 20mm cube", maxAttempts: 1 });
    const [code] = runCadCode.mock.calls[0];
    expect(code).toMatch(/from build123d import/);
    expect(code).not.toMatch(/sdf_kit/);
  });

  it("an unknown engine id falls back rather than failing the generation", async () => {
    await runHarness({
      prompt: "a 20mm cube",
      maxAttempts: 1,
      engine: "cadquery" as never,
    });
    const [, formats, , opts] = runCadCode.mock.calls[0];
    expect(opts?.engine).toBe("build123d");
    expect(formats).toEqual(["stl", "step", "topo"]);
  });

  it("sizes the sdf fallback from the prompt, like the b-rep one", async () => {
    await runHarness({ prompt: "a 40mm cube", maxAttempts: 1, engine: "sdf" });
    const [code] = runCadCode.mock.calls[0];
    expect(code).toMatch(/size = 40/);
  });
});
