// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { EnrichedQuote } from "../types";

vi.mock("@/components/ui/native-sheet", () => ({
  NativeSheet: ({
    open,
    onClose,
    children,
    ariaLabel,
  }: {
    open: boolean;
    onClose: () => void;
    children: React.ReactNode;
    ariaLabel: string;
  }) =>
    open ? (
      <div role="dialog" aria-label={ariaLabel}>
        <button type="button" onClick={onClose}>
          close sheet
        </button>
        {children}
      </div>
    ) : null,
}));

vi.mock("next/image", () => ({
  default: ({ src, alt }: { src: string; alt: string }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt} />
  ),
}));

import { VendorStep } from "../vendor-step";

function quote(overrides: Partial<EnrichedQuote>): EnrichedQuote {
  return {
    quoteId: "q",
    vendorId: "v1",
    vendorName: "PrintLab",
    vendorCountryCode: "US",
    vendorStateCode: "TX",
    modelId: "m",
    materialConfigId: "mc",
    quantity: 1,
    price: 10,
    currency: "USD",
    productionTimeFast: 3,
    productionTimeSlow: 7,
    scale: 1,
    materialId: "pla",
    materialName: "PLA",
    materialGroupId: "g",
    materialGroupName: "G",
    materialImage: null,
    materialSortIndex: 1,
    finishGroupId: "standard",
    finishGroupName: "Standard",
    finishGroupImage: "std.png",
    color: "White",
    colorCode: "#ffffff",
    configName: "default",
    ...overrides,
  };
}

const quotes: EnrichedQuote[] = [
  quote({
    quoteId: "std-white-v1",
    finishGroupId: "standard",
    finishGroupName: "Standard",
    finishGroupImage: "std.png",
    color: "White",
    price: 8,
    vendorName: "PrintLab",
  }),
  quote({
    quoteId: "std-black-v1",
    finishGroupId: "standard",
    finishGroupName: "Standard",
    finishGroupImage: "std.png",
    color: "Black",
    colorCode: "#111111",
    price: 9,
    vendorName: "PrintLab",
  }),
  quote({
    quoteId: "std-black-v3",
    finishGroupId: "standard",
    finishGroupName: "Standard",
    finishGroupImage: "std.png",
    color: "Black",
    colorCode: "#111111",
    price: 11,
    vendorId: "v3",
    vendorName: "NightWorks",
    vendorStateCode: null,
    vendorCountryCode: "DE",
  }),
  quote({
    quoteId: "pol-white-v1",
    finishGroupId: "polished",
    finishGroupName: "Polished",
    finishGroupImage: "pol.png",
    color: "White",
    price: 20,
    productionTimeFast: 8,
    productionTimeSlow: 12,
    vendorName: "PrintLab",
  }),
  quote({
    quoteId: "pol-white-v2",
    finishGroupId: "polished",
    finishGroupName: "Polished",
    finishGroupImage: "pol.png",
    color: "White",
    price: 22,
    productionTimeFast: 2,
    productionTimeSlow: 4,
    vendorId: "v2",
    vendorName: "MakerForge",
    vendorStateCode: "CA",
  }),
];

function renderStep(
  overrides: Partial<React.ComponentProps<typeof VendorStep>> = {}
) {
  return render(
    <VendorStep
      quotes={quotes}
      shipping={[]}
      sortQuantity={1}
      materialId="pla"
      selectedQuote={null}
      onPick={vi.fn()}
      onBack={vi.fn()}
      {...overrides}
    />
  );
}

describe("VendorStep finish + color filters", () => {
  it("preselects the cheapest finish and shows its image above color", () => {
    renderStep();

    const finishTrigger = screen.getByRole("button", {
      name: "Finish, Standard",
    });
    expect(finishTrigger).toBeTruthy();
    expect(finishTrigger.querySelector("img")?.getAttribute("src")).toContain(
      "std.png"
    );

    // Finish control is the first labeled field; color sits under it.
    const finishLabel = screen.getByText("Finish");
    const colorLabel = screen.getByText("Color");
    expect(
      finishLabel.compareDocumentPosition(colorLabel) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();

    expect(screen.getByText("PrintLab")).toBeTruthy();
    expect(screen.queryByText("MakerForge")).toBeNull();
  });

  it("opens a finish sheet and refilters vendors when a new finish is picked", () => {
    renderStep();

    // Closed trigger: name + image only — from-price lives on sheet options.
    const finishTrigger = screen.getByRole("button", {
      name: "Finish, Standard",
    });
    expect(finishTrigger.textContent).not.toMatch(/from\s*\$/);

    fireEvent.click(finishTrigger);
    expect(screen.getByRole("dialog", { name: "Choose a finish" })).toBeTruthy();
    const polishedOption = screen.getByRole("button", { name: "Polished" });
    expect(polishedOption).toBeTruthy();
    expect(polishedOption.textContent).toMatch(/from/);
    expect(polishedOption.textContent).toMatch(/\$/);

    fireEvent.click(polishedOption);
    expect(screen.queryByRole("dialog")).toBeNull();

    // Polished is now the trigger (still no price), and both polished vendors show.
    const polishedTrigger = screen.getByRole("button", {
      name: "Finish, Polished",
    });
    expect(polishedTrigger.textContent).not.toMatch(/from\s*\$/);
    expect(screen.getByText("PrintLab")).toBeTruthy();
    expect(screen.getByText("MakerForge")).toBeTruthy();
  });

  it("honors initialFinishGroupId over the cheapest finish", () => {
    renderStep({ initialFinishGroupId: "polished" });

    expect(screen.getByRole("button", { name: "Finish, Polished" })).toBeTruthy();
    expect(screen.getByText("MakerForge")).toBeTruthy();
    // Standard-only Black color must not appear — polished is White only.
    expect(screen.queryByLabelText("Color")).toBeNull();
  });

  it("defaults the vendor list to the cheapest color", () => {
    renderStep();
    expect(screen.getByText("PrintLab")).toBeTruthy();
    expect(screen.queryByText("NightWorks")).toBeNull();
  });

  it("filters vendors to a selectedQuote color", () => {
    renderStep({
      selectedQuote: quotes.find((q) => q.quoteId === "std-black-v3")!,
    });
    expect(screen.getByText("NightWorks")).toBeTruthy();
    expect(screen.getByText("PrintLab")).toBeTruthy();
    expect(screen.queryByText("MakerForge")).toBeNull();
  });

  it("hides the finish sheet trigger when a material has one finish", () => {
    renderStep({
      quotes: quotes.filter((q) => q.finishGroupId === "standard"),
    });

    expect(screen.getByText("Standard")).toBeTruthy();
    expect(screen.getByAltText("")).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Finish, Standard" })
    ).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("back always returns to materials", () => {
    const onBack = vi.fn();
    renderStep({ onBack });
    fireEvent.click(screen.getByRole("button", { name: "All materials" }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("does not chip a lone vendor", () => {
    renderStep();
    // Standard/White has only PrintLab — nothing to compare.
    expect(screen.queryByText("Cheapest")).toBeNull();
    expect(screen.queryByText("Fastest")).toBeNull();
  });

  it("chips Cheapest and Fastest among visible multi-vendor quotes", () => {
    renderStep({
      initialFinishGroupId: "polished",
      shipping: [
        { vendorId: "v1", price: 5, deliveryTime: 7 },
        { vendorId: "v2", price: 5, deliveryTime: 3 },
      ],
    });

    // PrintLab: 20+5=25$, 8+7=15d — Cheapest
    // MakerForge: 22+5=27$, 2+3=5d — Fastest
    expect(
      screen.getByRole("button", { name: "PrintLab, Cheapest" })
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "MakerForge, Fastest" })
    ).toBeTruthy();
    expect(screen.getByText("Cheapest")).toBeTruthy();
    expect(screen.getByText("Fastest")).toBeTruthy();
  });
});
