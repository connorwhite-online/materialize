import { describe, it, expect, afterEach } from "vitest";

import {
  extractRepoUrl,
  extractReadmeImagePaths,
  extractPdfUrls,
  fetchRepoContext,
} from "@/lib/cad/repo-fetch";

describe("extractRepoUrl", () => {
  it("finds a github repo url in prose", () => {
    expect(
      extractRepoUrl(
        "an enclosure for the device at this repo: https://github.com/acme/widget-fw please"
      )
    ).toEqual({
      owner: "acme",
      repo: "widget-fw",
      url: "https://github.com/acme/widget-fw",
    });
  });

  it("strips .git and trailing paths/punctuation", () => {
    expect(extractRepoUrl("see https://github.com/a/b.git.")?.repo).toBe("b");
    expect(
      extractRepoUrl("see https://github.com/a/b/tree/main/hardware")?.repo
    ).toBe("b");
  });

  it("returns null with no repo link", () => {
    expect(extractRepoUrl("a 20mm cube")).toBeNull();
    expect(extractRepoUrl("https://example.com/a/b")).toBeNull();
  });
});

describe("extractReadmeImagePaths", () => {
  it("finds markdown and html image refs, deduped, images only", () => {
    const readme = [
      "![front](docs/front.png)",
      "![again](docs/front.png)",
      '<img src="assets/side.jpg" width="400">',
      "[not an image](docs/manual.pdf)",
      "![remote](https://user-images.githubusercontent.com/1/shot.jpeg)",
    ].join("\n");
    expect(extractReadmeImagePaths(readme)).toEqual([
      "docs/front.png",
      "https://user-images.githubusercontent.com/1/shot.jpeg",
      "assets/side.jpg",
    ]);
  });
});

describe("extractPdfUrls", () => {
  it("finds https pdf urls, rejects unsafe hosts, caps at 2", () => {
    const prompt = [
      "datasheets: https://cdn.vendor.com/ds/esp32-s3.pdf",
      "http://insecure.com/x.pdf",
      "https://192.168.1.5/leak.pdf",
      "https://localhost/x.pdf",
      "https://user:pw@host.com/x.pdf",
      "https://a.com/1.pdf https://b.com/2.pdf https://c.com/3.pdf",
    ].join(" ");
    const urls = extractPdfUrls(prompt);
    expect(urls).toHaveLength(2);
    expect(urls[0]).toBe("https://cdn.vendor.com/ds/esp32-s3.pdf");
    expect(urls.every((u) => u.startsWith("https://"))).toBe(true);
  });

  it("returns [] with no pdf links", () => {
    expect(extractPdfUrls("a 20mm cube")).toEqual([]);
  });
});

describe("fetchRepoContext gating", () => {
  afterEach(() => {
    delete process.env.CAD_REPO_FETCH;
  });

  it("null when the prompt links no repo (no network touched)", async () => {
    expect(await fetchRepoContext("a 20mm cube")).toBeNull();
  });

  it("null when disabled", async () => {
    process.env.CAD_REPO_FETCH = "false";
    expect(
      await fetchRepoContext("case for https://github.com/a/b")
    ).toBeNull();
  });
});
