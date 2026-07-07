// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";

import { useKeyboardOpen } from "@/lib/hooks/use-keyboard-sticky-bottom";

type VVListener = () => void;

/** Minimal VisualViewport stub whose height we can drive. */
function installViewport(height: number) {
  const listeners: Record<string, VVListener[]> = { resize: [], scroll: [] };
  const vv = {
    height,
    offsetTop: 0,
    addEventListener: (t: string, cb: VVListener) => listeners[t]?.push(cb),
    removeEventListener: (t: string, cb: VVListener) => {
      listeners[t] = (listeners[t] ?? []).filter((f) => f !== cb);
    },
  };
  Object.defineProperty(window, "visualViewport", {
    value: vv,
    configurable: true,
    writable: true,
  });
  Object.defineProperty(window, "innerHeight", {
    value: 800,
    configurable: true,
    writable: true,
  });
  return {
    emit: (nextHeight: number) => {
      vv.height = nextHeight;
      act(() => listeners.resize.forEach((f) => f()));
    },
  };
}

describe("useKeyboardOpen (MTR-212)", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("is false when the visual viewport matches the layout viewport", () => {
    installViewport(800);
    const { result } = renderHook(() => useKeyboardOpen());
    expect(result.current).toBe(false);
  });

  it("flips true once the viewport shrinks past the threshold (keyboard up)", () => {
    const vp = installViewport(800);
    const { result } = renderHook(() => useKeyboardOpen(120));
    expect(result.current).toBe(false);
    // Keyboard opens → visual viewport shrinks by 320px (> 120 threshold).
    vp.emit(480);
    expect(result.current).toBe(true);
    // Keyboard closes → back to full height.
    vp.emit(800);
    expect(result.current).toBe(false);
  });

  it("ignores sub-threshold shrink (e.g. URL bar collapse)", () => {
    const vp = installViewport(800);
    const { result } = renderHook(() => useKeyboardOpen(120));
    vp.emit(720); // 80px < 120 threshold
    expect(result.current).toBe(false);
  });

  it("returns false when VisualViewport is unavailable", () => {
    Object.defineProperty(window, "visualViewport", {
      value: undefined,
      configurable: true,
      writable: true,
    });
    const { result } = renderHook(() => useKeyboardOpen());
    expect(result.current).toBe(false);
  });
});
