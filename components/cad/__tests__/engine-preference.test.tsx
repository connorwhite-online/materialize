// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";

import {
  ENGINE_PREFERENCE_KEY,
  readEnginePreference,
  useEnginePreference,
  writeEnginePreference,
} from "../engine-preference";

function Probe() {
  const [engine, setEngine] = useEnginePreference();
  return (
    <button type="button" onClick={() => setEngine("sdf")}>
      {engine}
    </button>
  );
}

// Node 25 ships its own `localStorage` global, which takes precedence over
// jsdom's and has no methods unless Node is started with
// --localstorage-file. A Map-backed Storage stands in for the browser's.
function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, String(v)),
  };
}

beforeEach(() => {
  Object.defineProperty(window, "localStorage", {
    value: memoryStorage(),
    configurable: true,
  });
});
afterEach(cleanup);

describe("engine preference", () => {
  it("defaults to B-rep with nothing stored", () => {
    expect(readEnginePreference()).toBe("brep");
  });

  it("survives a reload: what was written is what is read back", () => {
    writeEnginePreference("sdf");
    expect(window.localStorage.getItem(ENGINE_PREFERENCE_KEY)).toBe("sdf");
    expect(readEnginePreference()).toBe("sdf");
  });

  it("ignores a stale or garbage stored value", () => {
    window.localStorage.setItem(ENGINE_PREFERENCE_KEY, "cadquery");
    expect(readEnginePreference()).toBe("brep");
  });

  it("the hook starts from the stored choice and updates when it is set", () => {
    writeEnginePreference("sdf");
    render(<Probe />);
    expect(screen.getByRole("button").textContent).toBe("sdf");

    window.localStorage.clear();
    render(<Probe />);
    // Two probes now; the second mounted on an empty store.
    const [, fresh] = screen.getAllByRole("button");
    expect(fresh.textContent).toBe("brep");
    act(() => fresh.click());
    // One write, and every subscriber in the tab sees it.
    for (const b of screen.getAllByRole("button")) {
      expect(b.textContent).toBe("sdf");
    }
  });
});
