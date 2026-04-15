import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock createFileListing — per test swap the impl via closure.
let createImpl: (fd: FormData) => Promise<unknown> = async () => undefined;

vi.mock("@/app/actions/files", () => ({
  createFileListing: (fd: FormData) => createImpl(fd),
}));

import { runCreateListing, type CreateListingInput } from "../run-create-listing";

// Minimal XMLHttpRequest stub. Lets us control the PUT status,
// and fires the progress + load events synchronously on send().
class FakeXHR {
  static nextStatus = 200;
  static nextError: "network" | null = null;

  _uploadListeners = new Map<string, ((ev: ProgressEvent) => void)[]>();
  upload = {
    addEventListener: (type: string, cb: (ev: ProgressEvent) => void) => {
      const list = this._uploadListeners.get(type) ?? [];
      list.push(cb);
      this._uploadListeners.set(type, list);
    },
  };
  _listeners = new Map<string, (() => void)[]>();
  status = 200;

  addEventListener(type: string, cb: () => void) {
    const list = this._listeners.get(type) ?? [];
    list.push(cb);
    this._listeners.set(type, list);
  }
  open() {}
  setRequestHeader() {}
  send() {
    const progList = this._uploadListeners.get("progress") ?? [];
    for (const cb of progList) {
      cb({ lengthComputable: true, loaded: 50, total: 100 } as ProgressEvent);
    }
    queueMicrotask(() => {
      if (FakeXHR.nextError === "network") {
        for (const cb of this._listeners.get("error") ?? []) cb();
        return;
      }
      this.status = FakeXHR.nextStatus;
      for (const cb of this._listeners.get("load") ?? []) cb();
    });
  }
}

function mockPresign(opts?: {
  status?: number;
  body?: unknown;
}) {
  const status = opts?.status ?? 200;
  const body = opts?.body ?? {
    uploadUrl: "https://r2.example/upload-url",
    storageKey: "uploads/u/abc/carabiner.stl",
    format: "stl",
  };
  return vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  });
}

function makeInput(over: Partial<CreateListingInput> = {}): CreateListingInput {
  const fd = new FormData();
  fd.set("name", "Carabiner");
  return {
    file: new File(["hi"], "carabiner.stl", {
      type: "application/octet-stream",
    }),
    fileUnit: "mm",
    formData: fd,
    selectedDesignTags: ["strong", "lightweight"],
    recommendedMaterial: "pla",
    sellEnabled: false,
    license: "free",
    collectionChoice: "none",
    newCollectionName: "",
    ...over,
  };
}

describe("runCreateListing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    createImpl = async () => undefined;
    FakeXHR.nextStatus = 200;
    FakeXHR.nextError = null;
    // @ts-expect-error — stub for test
    globalThis.XMLHttpRequest = FakeXHR;
  });

  it("walks the full chain and returns ok on happy path", async () => {
    mockPresign();
    const onProgress = vi.fn();
    const onPhaseChange = vi.fn();
    const result = await runCreateListing(
      makeInput({ onProgress, onPhaseChange })
    );
    expect(result).toEqual({ ok: true });
    expect(onPhaseChange).toHaveBeenCalledWith("uploading");
    expect(onPhaseChange).toHaveBeenCalledWith("saving");
    expect(onProgress).toHaveBeenCalledWith(50);
  });

  it("returns the presign error when presign fails", async () => {
    mockPresign({ status: 413, body: { error: "File exceeds 200MB limit" } });
    const result = await runCreateListing(makeInput());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("File exceeds 200MB limit");
  });

  it("returns a generic R2 error when the PUT 4xxs", async () => {
    mockPresign();
    FakeXHR.nextStatus = 403;
    const result = await runCreateListing(makeInput());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/R2 upload failed/);
  });

  it("returns a network error when the XHR error event fires", async () => {
    mockPresign();
    FakeXHR.nextError = "network";
    const result = await runCreateListing(makeInput());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/Network error/);
  });

  it("propagates createFileListing field errors", async () => {
    mockPresign();
    createImpl = async () => ({ error: { name: ["Name is required"] } });
    const result = await runCreateListing(makeInput());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.fieldErrors).toEqual({ name: ["Name is required"] });
    }
  });

  it("catches unexpected thrown errors", async () => {
    mockPresign();
    createImpl = async () => {
      throw new Error("database exploded");
    };
    const result = await runCreateListing(makeInput());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("database exploded");
  });

  it("forces price=0 and license=free when sellEnabled is off", async () => {
    mockPresign();
    const seen: FormData[] = [];
    createImpl = async (fd) => {
      seen.push(fd);
      return undefined;
    };
    const input = makeInput({ sellEnabled: false, license: "commercial" });
    await runCreateListing(input);
    expect(seen[0].get("price")).toBe("0");
    expect(seen[0].get("license")).toBe("free");
  });

  it("uses the chosen license when sellEnabled is on", async () => {
    mockPresign();
    const seen: FormData[] = [];
    createImpl = async (fd) => {
      seen.push(fd);
      return undefined;
    };
    await runCreateListing(makeInput({ sellEnabled: true, license: "commercial" }));
    expect(seen[0].get("license")).toBe("commercial");
  });

  it("packs assetsJson with storageKey, format, fileSize, fileUnit", async () => {
    mockPresign();
    const seen: FormData[] = [];
    createImpl = async (fd) => {
      seen.push(fd);
      return undefined;
    };
    await runCreateListing(makeInput({ fileUnit: "in" }));
    const raw = seen[0].get("assetsJson") as string;
    const parsed = JSON.parse(raw);
    expect(parsed).toEqual([
      {
        storageKey: "uploads/u/abc/carabiner.stl",
        originalFilename: "carabiner.stl",
        format: "stl",
        fileSize: 2,
        fileUnit: "in",
      },
    ]);
  });

  it("appends each designTag and sets recommendedMaterialId", async () => {
    mockPresign();
    const seen: FormData[] = [];
    createImpl = async (fd) => {
      seen.push(fd);
      return undefined;
    };
    await runCreateListing(
      makeInput({
        selectedDesignTags: ["strong", "lightweight"],
        recommendedMaterial: "pla",
      })
    );
    expect(seen[0].getAll("designTags")).toEqual(["strong", "lightweight"]);
    expect(seen[0].get("recommendedMaterialId")).toBe("pla");
  });

  it("sets newCollectionName only when collectionChoice is __new__", async () => {
    mockPresign();
    const seen: FormData[] = [];
    createImpl = async (fd) => {
      seen.push(fd);
      return undefined;
    };
    await runCreateListing(
      makeInput({ collectionChoice: "__new__", newCollectionName: "Kitchen" })
    );
    expect(seen[0].get("collectionId")).toBe("__new__");
    expect(seen[0].get("newCollectionName")).toBe("Kitchen");
  });
});
