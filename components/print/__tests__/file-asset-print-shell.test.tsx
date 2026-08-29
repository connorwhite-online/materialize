// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { PreviewView } from "@/components/viewer/preview-camera";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("../quote-configurator", () => ({
  QuoteConfigurator: (props: { initialView?: PreviewView | null }) => (
    <div
      data-testid="quote-configurator"
      data-initial-view={
        props.initialView ? JSON.stringify(props.initialView) : ""
      }
    />
  ),
}));

vi.mock("../cart-slot-stack", () => ({
  CartSlotStack: () => null,
}));

import { FileAssetPrintShell } from "../file-asset-print-shell";

describe("FileAssetPrintShell", () => {
  const baseProps = {
    fileAssetId: "asset-1",
    filename: "part.stl",
    format: "stl",
    hasCachedModel: true,
    geometryData: null,
  };

  it("forwards the listing snapshot angle to QuoteConfigurator", () => {
    const initialView: PreviewView = {
      direction: [0, 0.5, 0.866],
      framing: 0.73,
    };

    render(<FileAssetPrintShell {...baseProps} initialView={initialView} />);

    expect(
      screen.getByTestId("quote-configurator").getAttribute("data-initial-view")
    ).toBe(JSON.stringify(initialView));
  });

  it("omits a snapshot angle when the listing never set one", () => {
    render(<FileAssetPrintShell {...baseProps} />);

    expect(
      screen.getByTestId("quote-configurator").getAttribute("data-initial-view")
    ).toBe("");
  });
});
