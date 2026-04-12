"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";

const SERVICE_FEE_RATE = 0.08;

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
  onCheckout: () => void;
  isCheckingOut: boolean;
}

export function PriceDisplay({
  selectedQuote,
  shipping,
  selectedShipping,
  onSelectShipping,
  quantity,
  onCheckout,
  isCheckingOut,
}: PriceDisplayProps) {
  if (!selectedQuote) {
    return (
      <Card>
        <CardContent className="py-8">
          <p className="text-muted-foreground text-center">
            Select a material to see pricing.
          </p>
        </CardContent>
      </Card>
    );
  }

  const vendorShipping = shipping.filter(
    (s) => s.vendorId === selectedQuote.vendorId
  );

  const materialCost = selectedQuote.price * quantity;
  const shippingCost = selectedShipping?.price ?? 0;
  const subtotal = materialCost + shippingCost;
  const serviceFee = subtotal * SERVICE_FEE_RATE;
  const total = subtotal + serviceFee;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Order Summary</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">Material ({quantity}x)</span>
          <span>${materialCost.toFixed(2)}</span>
        </div>

        <div className="pt-1">
          <p className="text-xs font-medium text-muted-foreground mb-2">
            Shipping
          </p>
          <RadioGroup
            value={selectedShipping?.shippingId ?? ""}
            onValueChange={(value) => {
              const option = vendorShipping.find((s) => s.shippingId === value);
              if (option) onSelectShipping(option);
            }}
          >
            {vendorShipping.map((option) => (
              <Label
                key={option.shippingId}
                htmlFor={option.shippingId}
                className="flex cursor-pointer items-center justify-between rounded-lg border border-border p-3 transition-colors has-[[data-state=checked]]:border-primary"
              >
                <div className="flex items-center gap-2">
                  <RadioGroupItem
                    value={option.shippingId}
                    id={option.shippingId}
                  />
                  <div>
                    <span className="text-sm">{option.name}</span>
                    <span className="ml-1 text-xs text-muted-foreground">
                      ({option.deliveryTime} days)
                    </span>
                  </div>
                </div>
                <span className="text-sm font-medium">
                  ${option.price.toFixed(2)}
                </span>
              </Label>
            ))}
          </RadioGroup>
        </div>

        <Separator />

        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">Service fee (8%)</span>
          <span>${serviceFee.toFixed(2)}</span>
        </div>

        <Separator />

        <div className="flex justify-between font-semibold">
          <span>Total</span>
          <span>${total.toFixed(2)}</span>
        </div>

        <Button
          onClick={onCheckout}
          disabled={!selectedShipping || isCheckingOut}
          className="w-full mt-2"
          size="lg"
        >
          {isCheckingOut ? "Processing..." : "Proceed to checkout"}
        </Button>
      </CardContent>
    </Card>
  );
}
