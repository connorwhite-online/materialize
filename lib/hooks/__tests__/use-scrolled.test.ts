// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  SCROLLED_THRESHOLD_PX,
  useScrolled,
} from "@/lib/hooks/use-scrolled";

function setScrollY(y: number) {
  Object.defineProperty(window, "scrollY", {
    value: y,
    configurable: true,
  });
  act(() => {
    window.dispatchEvent(new Event("scroll"));
  });
}

describe("useScrolled", () => {
  afterEach(() => {
    setScrollY(0);
    cleanup();
  });

  it("is false at the top of the page", () => {
    setScrollY(0);
    const { result } = renderHook(() => useScrolled());
    expect(result.current).toBe(false);
  });

  it("turns true once scroll passes the threshold", () => {
    setScrollY(0);
    const { result } = renderHook(() => useScrolled());
    setScrollY(SCROLLED_THRESHOLD_PX + 1);
    expect(result.current).toBe(true);
  });

  it("turns false again after scrolling back to the top", () => {
    setScrollY(80);
    const { result } = renderHook(() => useScrolled());
    expect(result.current).toBe(true);
    setScrollY(0);
    expect(result.current).toBe(false);
  });
});
