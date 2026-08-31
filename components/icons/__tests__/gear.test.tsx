// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { Gear } from "@/components/icons/gear";

describe("Gear", () => {
  it("renders a filled evenodd silhouette (not a stroked outline)", () => {
    const { container } = render(<Gear />);
    const path = container.querySelector("path");
    expect(path).toBeTruthy();
    expect(path?.getAttribute("fill")).toBe("currentColor");
    expect(path?.getAttribute("fill-rule")).toBe("evenodd");
    expect(path?.getAttribute("stroke")).toBeNull();
    // Hub cutout is a second subpath in the same evenodd path.
    const d = path?.getAttribute("d") ?? "";
    expect(d.split("M").length - 1).toBeGreaterThanOrEqual(2);
  });
});
