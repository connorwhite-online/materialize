// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ProjectTabs } from "../project-tabs";

describe("ProjectTabs", () => {
  it("skips the tab strip when there is only one panel", () => {
    render(
      <ProjectTabs
        tabs={[
          {
            value: "files",
            label: "Files",
            meta: 0,
            content: <p>Just the files panel</p>,
          },
        ]}
      />
    );

    expect(screen.getByText("Just the files panel")).toBeTruthy();
    expect(screen.queryByRole("tab")).toBeNull();
    expect(screen.queryByText("Files")).toBeNull();
  });

  it("renders the tab strip when there are multiple panels", () => {
    render(
      <ProjectTabs
        tabs={[
          {
            value: "files",
            label: "Files",
            content: <p>Files panel</p>,
          },
          {
            value: "guide",
            label: "Build Guide",
            content: <p>Guide panel</p>,
          },
        ]}
      />
    );

    expect(screen.getAllByRole("tab")).toHaveLength(2);
    expect(screen.getByRole("tab", { name: /files/i })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /build guide/i })).toBeTruthy();
  });
});
