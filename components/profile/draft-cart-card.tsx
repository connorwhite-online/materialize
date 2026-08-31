"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { discardDraftOrder, resumePrintOrder } from "@/app/actions/print";

interface DraftCartCardProps {
  orderId: string;
  /**
   * Which in-progress state the row is in:
   *   - "cart_created" (default) — classic draft, resumable into our
   *     Stripe checkout, discardable.
   *   - "awaiting_production_payment" — two_step order: our 3% fee is
   *     authorized, the CraftCloud order is placed, but the customer
   *     still owes CraftCloud for production + shipping. Resume points
   *     at the CraftCloud payment page; the order can't be discarded
   *     from here.
   */
  status?: "cart_created" | "awaiting_production_payment";
  fileAssetId: string | null;
  fileName: string | null;
  /** Friendly vendor label — falls back to vendor id or null upstream. */
  vendorName?: string | null;
  materialId: string | null;
  materialName: string | null;
  materialMethod: string | null;
  materialColor: string | null;
  total: number; // cents
}

export function DraftCartCard({
  orderId,
  status = "cart_created",
  fileAssetId,
  fileName,
  vendorName,
  materialId,
  materialName,
  materialMethod,
  materialColor,
  total,
}: DraftCartCardProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [resuming, startResume] = useTransition();
  const [resumeError, setResumeError] = useState<string | null>(null);
  const awaitingProductionPayment = status === "awaiting_production_payment";

  // Fallback when resumePrintOrder can't reuse or rebuild a Stripe
  // session (e.g. order has no saved address yet).
  //   - Legacy single-item drafts drop back into the quote
  //     configurator at the material step (they collect the address
  //     inline).
  //   - Multi-item drafts (no fileAssetId) have no inline address
  //     step, so land on /checkout/[orderId] where the form lives.
  const resumeHref =
    fileAssetId && materialId
      ? `/print/${fileAssetId}?material=${materialId}`
      : fileAssetId
        ? `/print/${fileAssetId}`
        : `/checkout/${orderId}`;

  const handleDiscard = () => {
    if (pending) return;
    startTransition(async () => {
      const result = await discardDraftOrder(orderId);
      if ("error" in result) {
        // Silently log — a toast would be nicer but we don't have one
        console.warn("[draft-cart] discard failed", result.error);
        return;
      }
      router.refresh();
    });
  };

  const handleResume = () => {
    if (resuming) return;
    setResumeError(null);
    startResume(async () => {
      const result = await resumePrintOrder(orderId);
      if ("error" in result) {
        // awaiting_production_payment rows can't fall back into the
        // quote configurator — the CraftCloud order is already placed.
        // Surface the server's error (e.g. expired fee authorization)
        // inline instead.
        if (awaitingProductionPayment) {
          setResumeError(result.error);
          return;
        }
        router.push(resumeHref);
        return;
      }
      window.location.href = result.checkoutUrl;
    });
  };

  return (
    // py-0: Card defaults to py-4; CardContent already pads the row.
    <Card className="py-0 transition-colors">
      <CardContent className="flex items-center justify-between gap-3 p-4">
        <div className="flex min-w-0 items-center gap-3">
          {materialColor && (
            <div
              className="h-8 w-8 shrink-0 rounded-md border border-border"
              style={{
                background: `linear-gradient(135deg, ${materialColor}, ${materialColor}dd)`,
              }}
            />
          )}
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">
              {fileName ?? "3D Print"}
            </p>
            <p className="truncate text-xs text-muted-foreground">
              {vendorName ? `${vendorName} · ` : ""}
              {materialName ?? "Material"}
              {materialMethod ? ` · ${materialMethod}` : ""}
              {total > 0 ? ` · $${(total / 100).toFixed(2)}` : ""}
            </p>
            {awaitingProductionPayment && (
              <div className="mt-0.5 text-xs text-amber-700 dark:text-amber-300">
                <p className="truncate font-medium">
                  Awaiting production payment
                </p>
                <p className="truncate">
                  Service fee authorized — finish paying CraftCloud for
                  production
                </p>
              </div>
            )}
            {resumeError && (
              <p className="mt-0.5 truncate text-xs text-destructive">
                {resumeError}
              </p>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {/* awaiting_production_payment rows are already placed at
              CraftCloud — only cart_created drafts can be discarded
              (matches the guard in discardDraftOrder). */}
          {!awaitingProductionPayment && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleDiscard}
              loading={pending}
              className="text-destructive"
            >
              Discard
            </Button>
          )}
          <Button size="sm" onClick={handleResume} loading={resuming}>
            {awaitingProductionPayment ? "Complete payment" : "Resume"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
