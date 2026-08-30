// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import type { EnrichedQuote } from "../types";

// The picker delegates rendering to the two step components and
// keeps the navigation state itself. To keep these tests focused on
// the state machine — preselect, back-to-materials, scope clearing —
// we replace each step with a button-shaped stub that surfaces the
// onPick / onBack / onClearScope callbacks. The real step components
// have their own UI surface area and are tested elsewhere; here we
// only care about transitions.
vi.mock("../material-step", () => ({
  MaterialStep: (props: {
    onPick: (id: string) => void;
    onClearScope?: () => void;
    materialScoped?: boolean;
  }) => (
    <div data-testid="material-step">
      <span data-testid="material-scoped">{String(!!props.materialScoped)}</span>
      <button onClick={() => props.onPick("pla")}>pick pla</button>
      <button onClick={() => props.onPick("petg")}>pick petg</button>
      {props.onClearScope && (
        <button onClick={() => props.onClearScope!()}>clear scope</button>
      )}
    </div>
  ),
}));

vi.mock("../vendor-step", () => ({
  VendorStep: (props: {
    materialId: string;
    initialFinishGroupId?: string;
    onPick: (quote: EnrichedQuote) => void;
    onBack: () => void;
  }) => (
    <div data-testid="vendor-step">
      <span data-testid="vendor-material">{props.materialId}</span>
      <span data-testid="vendor-finish">
        {props.initialFinishGroupId ?? ""}
      </span>
      <button
        onClick={() =>
          props.onPick({
            quoteId: "q-1",
            vendorId: "v-1",
            materialConfigId: "mc-1",
          } as EnrichedQuote)
        }
      >
        pick vendor
      </button>
      <button onClick={props.onBack}>vendor back</button>
    </div>
  ),
}));

import { MaterialPicker } from "../index";

function quote(overrides: Partial<EnrichedQuote>): EnrichedQuote {
  return {
    quoteId: "q",
    vendorId: "v",
    vendorName: "v",
    vendorCountryCode: null,
    vendorStateCode: null,
    modelId: "m",
    materialConfigId: "mc",
    quantity: 1,
    price: 10,
    currency: "USD",
    productionTimeFast: 1,
    productionTimeSlow: 2,
    scale: 1,
    materialId: "pla",
    materialName: "PLA",
    materialGroupId: "g",
    materialGroupName: "G",
    materialImage: null,
    materialSortIndex: 1,
    finishGroupId: "fg",
    finishGroupName: "Fg",
    finishGroupImage: null,
    color: "white",
    colorCode: "#fff",
    configName: "default",
    ...overrides,
  };
}

const multiFinishQuotes: EnrichedQuote[] = [
  quote({ quoteId: "1", materialId: "pla", finishGroupId: "matte" }),
  quote({ quoteId: "2", materialId: "pla", finishGroupId: "glossy" }),
];

function renderPicker(
  overrides: Partial<React.ComponentProps<typeof MaterialPicker>> = {}
) {
  return render(
    <MaterialPicker
      quotes={multiFinishQuotes}
      shipping={[]}
      sortQuantity={1}
      quotesLoading={false}
      selectedQuote={null}
      onSelectQuote={vi.fn()}
      {...overrides}
    />
  );
}

describe("MaterialPicker state machine", () => {
  it("starts on the material step when no preselect is provided", () => {
    renderPicker();
    expect(screen.getByTestId("material-step")).toBeTruthy();
    expect(screen.queryByTestId("vendor-step")).toBeNull();
  });

  it("walks material → vendor and reports the selection back", () => {
    const onSelectQuote = vi.fn();
    renderPicker({ onSelectQuote });

    fireEvent.click(screen.getByText("pick pla"));
    expect(screen.getByTestId("vendor-step")).toBeTruthy();
    expect(screen.getByTestId("vendor-material").textContent).toBe("pla");
    // Picking from the grid is not a Print-with-X arrival, so no
    // finish is forced — VendorStep picks the cheapest itself.
    expect(screen.getByTestId("vendor-finish").textContent).toBe("");

    fireEvent.click(screen.getByText("pick vendor"));
    expect(onSelectQuote).toHaveBeenCalledWith(
      expect.objectContaining({ quoteId: "q-1" })
    );
  });

  it("does not route through a finish step", () => {
    renderPicker();
    fireEvent.click(screen.getByText("pick pla"));
    expect(screen.getByTestId("vendor-step")).toBeTruthy();
    expect(screen.queryByTestId("finish-step")).toBeNull();
  });

  it("back from vendor returns to material and fires onClearPreselectScope", () => {
    const onClearPreselectScope = vi.fn();
    renderPicker({ onClearPreselectScope });

    fireEvent.click(screen.getByText("pick pla"));
    expect(screen.getByTestId("vendor-step")).toBeTruthy();

    fireEvent.click(screen.getByText("vendor back"));
    expect(screen.getByTestId("material-step")).toBeTruthy();
    expect(onClearPreselectScope).toHaveBeenCalledTimes(1);
  });

  it("preselectMaterialId jumps straight to vendor when a matching quote exists", () => {
    renderPicker({ preselectMaterialId: "pla" });
    expect(screen.getByTestId("vendor-step")).toBeTruthy();
    expect(screen.getByTestId("vendor-material").textContent).toBe("pla");
  });

  it("preselectFinishGroupId is forwarded when the pair matches", () => {
    renderPicker({
      preselectMaterialId: "pla",
      preselectFinishGroupId: "glossy",
    });
    expect(screen.getByTestId("vendor-step")).toBeTruthy();
    expect(screen.getByTestId("vendor-finish").textContent).toBe("glossy");
  });

  it("does not preselect-rubber-band the user back after they navigate to material", () => {
    const onClearPreselectScope = vi.fn();
    const { rerender } = render(
      <MaterialPicker
        quotes={multiFinishQuotes}
        shipping={[]}
        sortQuantity={1}
        quotesLoading={false}
        selectedQuote={null}
        onSelectQuote={vi.fn()}
        preselectMaterialId="pla"
        onClearPreselectScope={onClearPreselectScope}
      />
    );
    expect(screen.getByTestId("vendor-step")).toBeTruthy();

    fireEvent.click(screen.getByText("vendor back"));
    expect(screen.getByTestId("material-step")).toBeTruthy();
    expect(onClearPreselectScope).toHaveBeenCalledTimes(1);

    // Re-render with the same preselect prop still present (parent
    // hasn't dropped it yet) and a fresh quotes array reference — the
    // effect would re-run on dependency change. The preselectFiredRef
    // must keep the user where they are.
    act(() => {
      rerender(
        <MaterialPicker
          quotes={[...multiFinishQuotes]}
          shipping={[]}
          sortQuantity={1}
          quotesLoading={false}
          selectedQuote={null}
          onSelectQuote={vi.fn()}
          preselectMaterialId="pla"
          onClearPreselectScope={onClearPreselectScope}
        />
      );
    });
    expect(screen.getByTestId("material-step")).toBeTruthy();
    expect(screen.queryByTestId("vendor-step")).toBeNull();
  });

  it("does not preselect-jump when preselectMaterialId has no matching quote", () => {
    renderPicker({ preselectMaterialId: "nylon-not-in-quotes" });
    expect(screen.getByTestId("material-step")).toBeTruthy();
    expect(screen.queryByTestId("vendor-step")).toBeNull();
  });

  it("does not forward a finish preselect after the user picks a different material", () => {
    renderPicker({
      preselectMaterialId: "pla",
      preselectFinishGroupId: "glossy",
    });
    fireEvent.click(screen.getByText("vendor back"));
    fireEvent.click(screen.getByText("pick petg"));
    expect(screen.getByTestId("vendor-material").textContent).toBe("petg");
    expect(screen.getByTestId("vendor-finish").textContent).toBe("");
  });

  it("propagates materialScoped to the material step when a preselect is active", () => {
    // Preselect with NO matching quote so we stay on the material step
    // and can read the materialScoped prop without auto-advancing.
    renderPicker({ preselectMaterialId: "nylon-not-in-quotes" });
    expect(screen.getByTestId("material-scoped").textContent).toBe("true");
  });
});
