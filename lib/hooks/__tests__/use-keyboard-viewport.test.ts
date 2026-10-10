// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";

import { useKeyboardViewport } from "@/lib/hooks/use-keyboard-sticky-bottom";

type VVListener = () => void;

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
  Object.defineProperty(window, "visualViewport", { value: vv, configurable: true, writable: true });
  Object.defineProperty(window, "innerHeight", { value: 800, configurable: true, writable: true });
  return {
    emit: (nextHeight: number, nextOffsetTop = vv.offsetTop) => {
      vv.height = nextHeight;
      vv.offsetTop = nextOffsetTop;
      act(() => listeners.resize.forEach((f) => f()));
    },
  };
}

describe("useKeyboardViewport — where a dialog should centre", () => {
  afterEach(() => cleanup());

  it("is null with no keyboard, so dialogs keep their stylesheet centring", () => {
    installViewport(800);
    const { result } = renderHook(() => useKeyboardViewport());
    expect(result.current).toBeNull();
  });

  it("tracks the visible box while the keyboard is up, including iOS's scroll offset", () => {
    const vv = installViewport(800);
    const { result } = renderHook(() => useKeyboardViewport());
    vv.emit(450, 120);
    expect(result.current).toEqual({ top: 120, height: 450 });
    vv.emit(800, 0);
    expect(result.current).toBeNull();
  });

  it("ignores small viewport changes like the URL bar collapsing", () => {
    const vv = installViewport(800);
    const { result } = renderHook(() => useKeyboardViewport());
    vv.emit(740);
    expect(result.current).toBeNull();
  });
});
