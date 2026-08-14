// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";

import { useScrolledPast } from "@/lib/hooks/use-scrolled-past";

function setScrollY(y: number) {
  Object.defineProperty(window, "scrollY", {
    value: y,
    configurable: true,
    writable: true,
  });
}

describe("useScrolledPast", () => {
  afterEach(() => {
    cleanup();
    setScrollY(0);
    vi.restoreAllMocks();
  });

  it("is false at the top of the page", () => {
    setScrollY(0);
    const { result } = renderHook(() => useScrolledPast(24));
    expect(result.current).toBe(false);
  });

  it("flips true once scrollY exceeds the threshold", () => {
    setScrollY(0);
    const { result } = renderHook(() => useScrolledPast(24));
    setScrollY(40);
    act(() => window.dispatchEvent(new Event("scroll")));
    expect(result.current).toBe(true);
    setScrollY(8);
    act(() => window.dispatchEvent(new Event("scroll")));
    expect(result.current).toBe(false);
  });

  it("stays false when disabled, even after scrolling", () => {
    setScrollY(80);
    const { result } = renderHook(() => useScrolledPast(24, false));
    act(() => window.dispatchEvent(new Event("scroll")));
    expect(result.current).toBe(false);
  });
});
