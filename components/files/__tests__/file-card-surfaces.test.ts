import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";

const root = resolve(__dirname, "../../..");

function src(rel: string) {
  return readFileSync(resolve(root, rel), "utf8");
}

/**
 * Every file-card surface must import the shared component (or its
 * chrome constants). This is the lock that keeps the create-project
 * picker from growing another one-off tile.
 */
const FILE_CARD_SURFACES = [
  "app/(app)/files/page.tsx",
  "components/projects/project-create-form.tsx",
  "components/projects/add-project-files-dialog.tsx",
  "components/profile/library-file-card.tsx",
  "app/(app)/projects/[slug]/page.tsx",
  "components/home/home-dashboard.tsx",
  "components/home/search-results-panel.tsx",
  "app/(app)/collections/[slug]/page.tsx",
] as const;

describe("shared FileCard surfaces", () => {
  for (const file of FILE_CARD_SURFACES) {
    it(`${file} imports @/components/files/file-card`, () => {
      expect(src(file)).toContain('from "@/components/files/file-card"');
    });
  }

  it("does not overlay the filename on the thumbnail in project pickers", () => {
    expect(src("components/projects/project-create-form.tsx")).not.toContain(
      "from-black/70"
    );
    expect(src("components/projects/add-project-files-dialog.tsx")).not.toContain(
      "from-black/70"
    );
  });
});
