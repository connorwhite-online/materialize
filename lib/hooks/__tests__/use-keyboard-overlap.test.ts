// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";

import { useKeyboardOverlap } from "@/lib/hooks/use-keyboard-sticky-bottom";

type VVListener = () => void;

/**
 * Minimal VisualViewport stub whose height/offsetTop we can drive — same shape
 * as the `useKeyboardOpen` spec's stub, kept local so neither test can break
 * the other by reshaping a shared fixture.
 */
function installViewport(height: number, offsetTop = 0) {
  const listeners: Record<string, VVListener[]> = { resize: [], scroll: [] };
  const vv = {
    height,
    offsetTop,
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
    emit: (nextHeight: number, nextOffsetTop = vv.offsetTop) => {
      vv.height = nextHeight;
      vv.offsetTop = nextOffsetTop;
      act(() => listeners.resize.forEach((f) => f()));
    },
    scroll: () => act(() => listeners.scroll.forEach((f) => f())),
    listenerCounts: () => ({
      resize: listeners.resize.length,
      scroll: listeners.scroll.length,
    }),
  };
}

describe("useKeyboardOverlap — keyboard height for sheet layout", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("is 0 when the visual viewport matches the layout viewport", () => {
    installViewport(800);
    const { result } = renderHook(() => useKeyboardOverlap());
    expect(result.current).toBe(0);
  });

  it("reports the exact overlap in px while the keyboard is open", () => {
    const vp = installViewport(800);
    const { result } = renderHook(() => useKeyboardOverlap());
    vp.emit(480);
    expect(result.current).toBe(320);
    // Partial shrink is reported verbatim — unlike useKeyboardOpen there is no
    // threshold here; a sheet should follow the viewport exactly.
    vp.emit(720);
    expect(result.current).toBe(80);
    vp.emit(800);
    expect(result.current).toBe(0);
  });

  it("subtracts offsetTop so a scrolled visual viewport doesn't inflate the overlap", () => {
    const vp = installViewport(800);
    const { result } = renderHook(() => useKeyboardOverlap());
    // Visual viewport shrunk to 480 AND panned down 100px: the bottom overlap
    // is 800 - 480 - 100 = 220, not 320.
    vp.emit(480, 100);
    expect(result.current).toBe(220);
  });

  it("never reports a negative overlap when the visual viewport is taller", () => {
    const vp = installViewport(800);
    const { result } = renderHook(() => useKeyboardOverlap());
    vp.emit(900);
    expect(result.current).toBe(0);
  });

  it("responds to visual-viewport scroll, not just resize", () => {
    const vp = installViewport(800);
    const { result } = renderHook(() => useKeyboardOverlap());
    expect(vp.listenerCounts()).toEqual({ resize: 1, scroll: 1 });
    expect(result.current).toBe(0);
  });

  it("detaches its listeners on unmount", () => {
    const vp = installViewport(800);
    const { unmount } = renderHook(() => useKeyboardOverlap());
    expect(vp.listenerCounts()).toEqual({ resize: 1, scroll: 1 });
    unmount();
    expect(vp.listenerCounts()).toEqual({ resize: 0, scroll: 0 });
  });

  it("returns 0 when VisualViewport is unavailable (SSR / older browsers)", () => {
    Object.defineProperty(window, "visualViewport", {
      value: undefined,
      configurable: true,
      writable: true,
    });
    const { result } = renderHook(() => useKeyboardOverlap());
    expect(result.current).toBe(0);
  });
});
