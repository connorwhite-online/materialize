"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Alert } from "@/components/ui/alert";
import { ShippingAddressForm } from "@/components/print/shipping-address-form";
import { completePrintOrder } from "@/app/actions/print";

export interface CheckoutItem {
  fileName: string | null;
  originalFilename: string | null;
  quantity: number;
  /** Unit price in cents. */
  materialSubtotal: number;
}

interface CheckoutFormProps {
  orderId: string;
  items: CheckoutItem[];
  /**
   * Order-level shipping total in cents. Lives on printOrders, not
   * on individual items, so same-vendor multi-item orders don't
   * double-charge the shipping fee.
   */
  shippingTotal: number;
  /** Vendor minimum production fee, in cents. */
  productionFee: number;
  /** Total print price (incl. production fee + shipping), in cents. */
  totalPrice: number;
  /** Platform fee (3%), in cents. */
  serviceFee: number;
}

export function CheckoutForm({
  orderId,
  items,
  shippingTotal,
  productionFee,
  totalPrice,
  serviceFee,
}: CheckoutFormProps) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (data: {
    email: string;
    shipping: {
      firstName: string;
      lastName: string;
      address: string;
      addressLine2?: string;
      city: string;
      zipCode: string;
      stateCode?: string;
      countryCode: string;
      companyName?: string;
      phoneNumber?: string;
    };
    billing: {
      firstName: string;
      lastName: string;
      address: string;
      addressLine2?: string;
      city: string;
      zipCode: string;
      stateCode?: string;
      countryCode: string;
      companyName?: string;
      phoneNumber?: string;
      isCompany: boolean;
      vatId?: string;
    };
  }) => {
    setSubmitting(true);
    setError(null);

    const result = await completePrintOrder({
      orderId,
      email: data.email,
      shipping: data.shipping,
      billing: data.billing,
    });

    if ("error" in result) {
      setError(result.error);
      setSubmitting(false);
      return;
    }

    window.location.href = result.checkoutUrl;
  };

  return (
    <div className="grid items-start gap-6 lg:grid-cols-5">
      <div className="lg:col-span-3">
        {error && (
          <Alert variant="destructive" className="mb-4">
            <p className="text-sm">{error}</p>
          </Alert>
        )}
        <ShippingAddressForm
          onSubmit={handleSubmit}
          onBack={() => router.back()}
          isSubmitting={submitting}
        />
      </div>

      <div className="lg:col-span-2 lg:sticky lg:top-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Order Summary</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {items.map((item, idx) => {
              const name =
                item.fileName ??
                item.originalFilename?.replace(/\.[^.]+$/, "") ??
                "3D Print";
              const lineTotal = item.materialSubtotal * item.quantity;
              return (
                <div key={idx} className="flex justify-between text-sm">
                  <span className="text-muted-foreground truncate pr-2">
                    {name} ({item.quantity}x)
                  </span>
                  <span className="tabular-nums shrink-0">
                    ${(lineTotal / 100).toFixed(2)}
                  </span>
                </div>
              );
            })}

            {productionFee > 0 && (
              <div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">
                    Vendor minimum fee
                  </span>
                  <span className="tabular-nums">
                    +${(productionFee / 100).toFixed(2)}
                  </span>
                </div>
                <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">
                  Additional charge to meet this vendor&apos;s minimum production
                  requirement
                </p>
              </div>
            )}

            {shippingTotal > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Shipping</span>
                <span className="tabular-nums">
                  ${(shippingTotal / 100).toFixed(2)}
                </span>
              </div>
            )}

            <Separator />

            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Service fee (3%)</span>
              <span className="tabular-nums">
                ${(serviceFee / 100).toFixed(2)}
              </span>
            </div>

            <Separator />

            <div className="flex justify-between font-semibold">
              <span>Total</span>
              <span className="tabular-nums">
                ${((totalPrice + serviceFee) / 100).toFixed(2)}
              </span>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
