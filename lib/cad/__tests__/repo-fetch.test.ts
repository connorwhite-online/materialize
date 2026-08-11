import { describe, it, expect, afterEach } from "vitest";

import {
  extractRepoUrl,
  extractReadmeImagePaths,
  extractKicadFacts,
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

describe("extractKicadFacts", () => {
  it("measures the board outline bbox from Edge.Cuts", () => {
    const pcb = `
      (gr_line (start 100 50) (end 158.4 50) (stroke (width 0.1)) (layer "Edge.Cuts"))
      (gr_line (start 158.4 50) (end 158.4 142.1) (stroke (width 0.1)) (layer "Edge.Cuts"))
      (gr_line (start 158.4 142.1) (end 100 142.1) (stroke (width 0.1)) (layer "Edge.Cuts"))
      (gr_line (start 100 142.1) (end 100 50) (stroke (width 0.1)) (layer "Edge.Cuts"))
    `;
    const facts = extractKicadFacts(pcb);
    expect(facts[0]).toContain("58.4 x 92.1 mm");
    expect(facts[0]).toContain("Edge.Cuts");
  });

  it("counts non-plated mounting drills by diameter", () => {
    const pcb = `
      (pad "" np_thru_hole circle (at 0 0) (size 5.4 5.4) (drill 3.2) (layers "*.Cu"))
      (pad "" np_thru_hole circle (at 10 0) (size 5.4 5.4) (drill 3.2) (layers "*.Cu"))
      (pad "1" thru_hole circle (at 5 5) (size 1.7 1.7) (drill 1.0) (layers "*.Cu"))
    `;
    const facts = extractKicadFacts(pcb);
    expect(facts.some((f) => f.includes("2 x 3.2 mm drill"))).toBe(true);
    // Plated (component) holes are not mounting holes.
    expect(facts.some((f) => f.includes("1.0"))).toBe(false);
  });

  it("returns [] for garbage", () => {
    expect(extractKicadFacts("not a board")).toEqual([]);
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
