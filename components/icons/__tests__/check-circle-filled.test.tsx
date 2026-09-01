// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { CheckCircleFilled } from "@/components/icons/check-circle-filled";

describe("CheckCircleFilled", () => {
  it("renders a solid disc with a round-cap check cut in --background", () => {
    const { container } = render(<CheckCircleFilled size={14} />);
    const circle = container.querySelector("circle");
    expect(circle?.getAttribute("fill")).toBe("currentColor");
    expect(circle?.getAttribute("r")).toBe("10");
    const check = container.querySelector("path");
    expect(check?.getAttribute("stroke")).toBe("var(--background)");
    expect(check?.getAttribute("stroke-linecap")).toBe("round");
    expect(check?.getAttribute("stroke-linejoin")).toBe("round");
  });
});
