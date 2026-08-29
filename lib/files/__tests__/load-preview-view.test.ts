import { beforeEach, describe, expect, it, vi } from "vitest";

const { whereMock, logErrorMock } = vi.hoisted(() => ({
  whereMock: vi.fn(),
  logErrorMock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: whereMock,
      }),
    }),
  },
}));

vi.mock("@/lib/logger", () => ({
  logError: logErrorMock,
}));

import { loadPreviewView } from "../load-preview-view";

describe("loadPreviewView", () => {
  beforeEach(() => {
    whereMock.mockReset();
    logErrorMock.mockReset();
  });

  it("maps a complete row through savedPreviewView", async () => {
    whereMock.mockResolvedValue([
      {
        previewDirX: 0,
        previewDirY: 0.5,
        previewDirZ: 0.866,
        previewFraming: 0.73,
      },
    ]);

    const view = await loadPreviewView("file-1");
    expect(view).not.toBeNull();
    expect(view!.framing).toBe(0.73);
    const [dx, dy, dz] = view!.direction;
    expect(Math.hypot(dx, dy, dz)).toBeCloseTo(1, 10);
    expect(dy).toBeGreaterThan(0);
    expect(dz).toBeGreaterThan(0);
  });

  it("returns null when the row is missing or the camera is unset", async () => {
    whereMock.mockResolvedValue([]);
    expect(await loadPreviewView("missing")).toBeNull();

    whereMock.mockResolvedValue([
      {
        previewDirX: null,
        previewDirY: null,
        previewDirZ: null,
        previewFraming: null,
      },
    ]);
    expect(await loadPreviewView("unset")).toBeNull();
  });

  it("fails soft and logs when the preview columns are unreadable", async () => {
    whereMock.mockRejectedValue(new Error("column preview_dir_x does not exist"));

    expect(await loadPreviewView("file-unreadable")).toBeNull();
    expect(logErrorMock).toHaveBeenCalledWith(
      "loadPreviewView",
      expect.any(Error)
    );
  });
});
