// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import type { EnrichedQuote } from "../types";

// The picker delegates rendering to the three step components and
// keeps the navigation state itself. To keep these tests focused on
// the state machine — preselect, single-finish back-skip, scope
// clearing — we replace each step with a button-shaped stub that
// surfaces the onPick / onBack / onClearScope callbacks. The real
// step components have their own UI surface area and are tested
// elsewhere; here we only care about transitions.
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

vi.mock("../finish-step", () => ({
  FinishStep: (props: {
    materialId: string;
    onPick: (id: string) => void;
    onBack: () => void;
  }) => (
    <div data-testid="finish-step">
      <span data-testid="finish-material">{props.materialId}</span>
      <button onClick={() => props.onPick("matte")}>pick matte</button>
      <button onClick={props.onBack}>finish back</button>
    </div>
  ),
}));

vi.mock("../vendor-step", () => ({
  VendorStep: (props: {
    materialId: string;
    finishGroupId: string;
    backLabel: string;
    onPick: (quote: EnrichedQuote) => void;
    onBack: () => void;
  }) => (
    <div data-testid="vendor-step">
      <span data-testid="vendor-material">{props.materialId}</span>
      <span data-testid="vendor-finish">{props.finishGroupId}</span>
      <span data-testid="vendor-back-label">{props.backLabel}</span>
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

const singleFinishQuotes: EnrichedQuote[] = [
  quote({ quoteId: "1", materialId: "pla", finishGroupId: "matte" }),
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
    expect(screen.queryByTestId("finish-step")).toBeNull();
    expect(screen.queryByTestId("vendor-step")).toBeNull();
  });

  it("walks material → finish → vendor and reports the selection back", () => {
    const onSelectQuote = vi.fn();
    renderPicker({ onSelectQuote });

    fireEvent.click(screen.getByText("pick pla"));
    expect(screen.getByTestId("finish-step")).toBeTruthy();
    expect(screen.getByTestId("finish-material").textContent).toBe("pla");

    fireEvent.click(screen.getByText("pick matte"));
    expect(screen.getByTestId("vendor-step")).toBeTruthy();
    expect(screen.getByTestId("vendor-material").textContent).toBe("pla");
    expect(screen.getByTestId("vendor-finish").textContent).toBe("matte");

    fireEvent.click(screen.getByText("pick vendor"));
    expect(onSelectQuote).toHaveBeenCalledWith(
      expect.objectContaining({ quoteId: "q-1" })
    );
  });

  it("back from finish returns to material and fires onClearPreselectScope", () => {
    const onClearPreselectScope = vi.fn();
    renderPicker({ onClearPreselectScope });

    fireEvent.click(screen.getByText("pick pla"));
    expect(screen.getByTestId("finish-step")).toBeTruthy();

    fireEvent.click(screen.getByText("finish back"));
    expect(screen.getByTestId("material-step")).toBeTruthy();
    expect(onClearPreselectScope).toHaveBeenCalledTimes(1);
  });

  it("preselectMaterialId jumps straight to finish when a matching quote exists", () => {
    renderPicker({ preselectMaterialId: "pla" });
    expect(screen.getByTestId("finish-step")).toBeTruthy();
    expect(screen.getByTestId("finish-material").textContent).toBe("pla");
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
    // Lands on finish from the preselect.
    expect(screen.getByTestId("finish-step")).toBeTruthy();

    fireEvent.click(screen.getByText("finish back"));
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
    expect(screen.queryByTestId("finish-step")).toBeNull();
  });

  it("does not preselect-jump when preselectMaterialId has no matching quote", () => {
    renderPicker({ preselectMaterialId: "nylon-not-in-quotes" });
    expect(screen.getByTestId("material-step")).toBeTruthy();
    expect(screen.queryByTestId("finish-step")).toBeNull();
  });

  it("for a single-finish material, vendor back skips finish and returns to material", () => {
    const onClearPreselectScope = vi.fn();
    renderPicker({
      quotes: singleFinishQuotes,
      onClearPreselectScope,
    });

    fireEvent.click(screen.getByText("pick pla"));
    fireEvent.click(screen.getByText("pick matte"));
    expect(screen.getByTestId("vendor-step")).toBeTruthy();
    // Single-finish materials get the "All materials" copy on the
    // back button so the label matches where the click goes.
    expect(screen.getByTestId("vendor-back-label").textContent).toBe(
      "All materials"
    );

    fireEvent.click(screen.getByText("vendor back"));
    expect(screen.getByTestId("material-step")).toBeTruthy();
    expect(onClearPreselectScope).toHaveBeenCalledTimes(1);
  });

  it("for a multi-finish material, vendor back returns to finish", () => {
    renderPicker();

    fireEvent.click(screen.getByText("pick pla"));
    fireEvent.click(screen.getByText("pick matte"));
    expect(screen.getByTestId("vendor-step")).toBeTruthy();
    expect(screen.getByTestId("vendor-back-label").textContent).toBe(
      "Finishes"
    );

    fireEvent.click(screen.getByText("vendor back"));
    expect(screen.getByTestId("finish-step")).toBeTruthy();
  });

  it("propagates materialScoped to the material step when a preselect is active", () => {
    // Preselect with NO matching quote so we stay on the material step
    // and can read the materialScoped prop without auto-advancing.
    renderPicker({ preselectMaterialId: "nylon-not-in-quotes" });
    expect(screen.getByTestId("material-scoped").textContent).toBe("true");
  });
});
