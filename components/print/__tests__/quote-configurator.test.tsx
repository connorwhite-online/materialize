// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import type { EnrichedQuote } from "../material-picker/types";
import type { QuoteSnapshot } from "../poll-quotes";

// CON-38 — QuoteConfigurator wiring.
//
// Mounting the full configurator under jsdom pulls in three.js via
// MaterialPreview, and the live e2e path is blocked behind the mock
// CraftCloud catalog mismatch (same constraint shipping-address-form.test
// documents). So heavy / irrelevant children are stubbed and we assert
// the configurator's own logic:
//
//   - ensureModelUploaded is SKIPPED in draft mode — no download-url or
//     cache-model fetch fires, and the client uploader is never called.
//   - the anon checkout chain can't double-fire: the checkoutInFlightRef
//     guard collapses two rapid address submits into a single
//     runAnonCheckout invocation.
//
// The quote-stability-gate invariant is covered against the REAL
// pollQuotes loop in the sibling poll-quotes-stability.test.ts (a module
// mock of pollQuotes here would otherwise leak into that assertion).

// The 3D viewer needs WebGL; the picker has its own suite. Stub both.
vi.mock("@/components/viewer/material-preview", () => ({
  MaterialPreview: () => null,
}));

vi.mock("../material-picker", () => ({
  MaterialPicker: (props: { onSelectQuote: (q: EnrichedQuote) => void }) => (
    <button
      onClick={() =>
        props.onSelectQuote({
          quoteId: "q1",
          vendorId: "v1",
          vendorName: "Acme",
          materialConfigId: "mc1",
          price: 12,
          currency: "USD",
        } as EnrichedQuote)
      }
    >
      select quote
    </button>
  ),
}));

vi.mock("../price-display", () => ({
  PriceDisplay: (props: {
    onSelectShipping: (s: unknown) => void;
    onCheckout: () => void;
  }) => (
    <div>
      <button
        onClick={() =>
          props.onSelectShipping({
            shippingId: "s1",
            vendorId: "v1",
            name: "Std",
            deliveryTime: 5,
            price: 3,
            type: "standard",
          })
        }
      >
        select shipping
      </button>
      <button onClick={props.onCheckout}>checkout</button>
    </div>
  ),
}));

vi.mock("../shipping-address-form", () => ({
  ShippingAddressForm: (props: { onSubmit: (data: unknown) => void }) => (
    <button
      onClick={() =>
        props.onSubmit({
          email: "ada@example.com",
          shipping: {
            firstName: "Ada",
            lastName: "L",
            address: "1 St",
            city: "London",
            zipCode: "NW1",
            countryCode: "US",
          },
          billing: {
            firstName: "Ada",
            lastName: "L",
            address: "1 St",
            city: "London",
            zipCode: "NW1",
            countryCode: "US",
            isCompany: false,
          },
        })
      }
    >
      submit address
    </button>
  ),
}));

// Drive the quote pipeline deterministically — no real polling.
const pollQuotesMock = vi.fn();
vi.mock("../poll-quotes", async () => {
  const actual = await vi.importActual<typeof import("../poll-quotes")>(
    "../poll-quotes"
  );
  return {
    ...actual,
    pollQuotes: (opts: { onSnapshot: (s: QuoteSnapshot) => void }) =>
      pollQuotesMock(opts),
  };
});

const runAnonCheckoutMock = vi.fn();
vi.mock("../run-anon-checkout", () => ({
  runAnonCheckout: (args: unknown) => runAnonCheckoutMock(args),
}));

const uploadToCraftCloudMock = vi.fn();
vi.mock("@/lib/craftcloud/upload-client", () => ({
  uploadToCraftCloud: (...args: unknown[]) => uploadToCraftCloudMock(...args),
}));

vi.mock("@/app/actions/print", () => ({
  createPrintOrder: vi.fn(),
  completePrintOrder: vi.fn(),
  checkCartPricing: vi.fn(async () => ({ error: "skip" })),
}));

vi.mock("../cart-context", () => ({
  useCart: () => null,
}));

import { QuoteConfigurator } from "../quote-configurator";

const STABLE_QUOTE: EnrichedQuote = {
  quoteId: "q1",
  vendorId: "v1",
  vendorName: "Acme",
  vendorCountryCode: null,
  vendorStateCode: null,
  modelId: "m",
  materialConfigId: "mc1",
  quantity: 1,
  price: 12,
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
  color: "white",
  colorCode: "#fff",
  finishGroupImage: null,
  configName: "default",
};

function installLocalStorage() {
  const store = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, String(v)),
      removeItem: (k: string) => store.delete(k),
      clear: () => store.clear(),
    },
  });
}

describe("QuoteConfigurator wiring (CON-38)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    installLocalStorage();

    pollQuotesMock.mockImplementation(
      async (opts: { onSnapshot: (s: QuoteSnapshot) => void }) => {
        opts.onSnapshot({
          quotes: [STABLE_QUOTE],
          shipping: [
            {
              shippingId: "s1",
              vendorId: "v1",
              name: "Std",
              deliveryTime: 5,
              price: 3,
              type: "standard",
            },
          ],
          allComplete: true,
        });
        return "complete";
      }
    );
    runAnonCheckoutMock.mockResolvedValue({
      ok: true,
      checkoutUrl: "https://stripe.test/session",
    });

    // jsdom doesn't implement object URLs; the draft-mode preview effect
    // calls these.
    URL.createObjectURL = vi.fn(() => "blob:mock");
    URL.revokeObjectURL = vi.fn();
    // jsdom throws on navigation; the success path sets location.href.
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { href: "" },
    });
  });

  function draftProps() {
    const file = new File(["solid"], "part.stl", { type: "model/stl" });
    return {
      draftMode: { modelId: "model-123", file },
      filename: "part.stl",
      // Non-previewable format — defensive; MaterialPreview is mocked too.
      format: "step",
      hasCachedModel: false,
      geometryData: null,
    };
  }

  it("skips ensureModelUploaded in draft mode (no download-url / cache-model fetch)", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("/api/craftcloud/quotes")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ priceId: "price-1" }),
        } as unknown as Response;
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({}),
      } as unknown as Response;
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<QuoteConfigurator {...draftProps()} />);

    await screen.findByText("select quote");

    const calledUrls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(calledUrls.some((u) => u.includes("/download-url"))).toBe(false);
    expect(calledUrls.some((u) => u.includes("/cache-model"))).toBe(false);
    expect(uploadToCraftCloudMock).not.toHaveBeenCalled();
    // The quote START request did fire (the legitimate draft-mode call).
    expect(
      calledUrls.some((u) => u.includes("/api/craftcloud/quotes"))
    ).toBe(true);
  });

  it("checkoutInFlightRef prevents the anon checkout chain from double-firing", async () => {
    const fetchMock = vi.fn(
      async () =>
        ({
          ok: true,
          status: 200,
          json: async () => ({ priceId: "price-1" }),
        } as unknown as Response)
    );
    vi.stubGlobal("fetch", fetchMock);

    // Keep the first invocation in-flight while the second fires — the
    // exact double-tap race the ref guards against.
    let release: (v: { ok: true; checkoutUrl: string }) => void = () => {};
    runAnonCheckoutMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        })
    );

    render(<QuoteConfigurator {...draftProps()} />);

    fireEvent.click(await screen.findByText("select quote"));
    fireEvent.click(await screen.findByText("select shipping"));
    fireEvent.click(screen.getByText("checkout"));

    const submit = await screen.findByText("submit address");
    await act(async () => {
      fireEvent.click(submit);
      fireEvent.click(submit);
    });

    await waitFor(() => expect(runAnonCheckoutMock).toHaveBeenCalledTimes(1));

    await act(async () => {
      release({ ok: true, checkoutUrl: "https://stripe.test/session" });
    });
  });
});
