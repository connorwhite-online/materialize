"use client";

const SERVICE_FEE_RATE = 0.08; // 8%

interface Quote {
  quoteId: string;
  vendorId: string;
  materialConfigId: string;
  price: number;
  currency: string;
}

interface ShippingOption {
  shippingId: string;
  vendorId: string;
  name: string;
  deliveryTime: number;
  price: number;
  type: "standard" | "express";
}

interface PriceDisplayProps {
  selectedQuote: Quote | null;
  shipping: ShippingOption[];
  selectedShipping: ShippingOption | null;
  onSelectShipping: (option: ShippingOption) => void;
  quantity: number;
  fileAssetId: string;
}

export function PriceDisplay({
  selectedQuote,
  shipping,
  selectedShipping,
  onSelectShipping,
  quantity,
  fileAssetId,
}: PriceDisplayProps) {
  if (!selectedQuote) {
    return (
      <div className="rounded-lg border border-foreground/10 p-6">
        <p className="text-foreground/60">Select a material to see pricing.</p>
      </div>
    );
  }

  // Filter shipping options for the selected vendor
  const vendorShipping = shipping.filter(
    (s) => s.vendorId === selectedQuote.vendorId
  );

  const materialCost = selectedQuote.price * quantity;
  const shippingCost = selectedShipping?.price ?? 0;
  const subtotal = materialCost + shippingCost;
  const serviceFee = subtotal * SERVICE_FEE_RATE;
  const total = subtotal + serviceFee;

  return (
    <div className="rounded-lg border border-foreground/10 p-6">
      <h2 className="font-semibold">Order Summary</h2>

      <div className="mt-4 space-y-2 text-sm">
        <div className="flex justify-between">
          <span className="text-foreground/60">
            Material ({quantity}x)
          </span>
          <span>${materialCost.toFixed(2)}</span>
        </div>

        <div className="mt-3">
          <p className="text-xs font-medium text-foreground/60 mb-2">
            Shipping
          </p>
          {vendorShipping.map((option) => (
            <label
              key={option.shippingId}
              className={`flex cursor-pointer items-center justify-between rounded-md border p-2 mb-1 ${
                selectedShipping?.shippingId === option.shippingId
                  ? "border-foreground"
                  : "border-foreground/10"
              }`}
            >
              <div className="flex items-center gap-2">
                <input
                  type="radio"
                  name="shipping"
                  checked={
                    selectedShipping?.shippingId === option.shippingId
                  }
                  onChange={() => onSelectShipping(option)}
                  className="accent-foreground"
                />
                <div>
                  <span className="text-sm">{option.name}</span>
                  <span className="ml-1 text-xs text-foreground/50">
                    ({option.deliveryTime} days)
                  </span>
                </div>
              </div>
              <span className="text-sm">${option.price.toFixed(2)}</span>
            </label>
          ))}
        </div>

        <div className="flex justify-between border-t border-foreground/10 pt-2">
          <span className="text-foreground/60">Service fee (8%)</span>
          <span>${serviceFee.toFixed(2)}</span>
        </div>

        <div className="flex justify-between border-t border-foreground/10 pt-2 font-semibold">
          <span>Total</span>
          <span>${total.toFixed(2)}</span>
        </div>
      </div>

      <button
        disabled={!selectedShipping}
        className="mt-4 w-full rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background transition-colors hover:bg-foreground/90 disabled:opacity-50"
      >
        Proceed to checkout
      </button>
    </div>
  );
}
