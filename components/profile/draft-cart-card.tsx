"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatUsd } from "@/components/ui/summary-list";
import { MaterialSwatch } from "./material-swatch";
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
    <div className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <MaterialSwatch color={materialColor} />
        <div className="min-w-0">
          <p className="truncate text-sm leading-5 font-medium">
            {fileName ?? "3D Print"}
          </p>
          <p className="truncate text-[13px] leading-[18px] text-muted-foreground">
            {awaitingProductionPayment ? (
              <span className="text-warning">Pay CraftCloud to start production</span>
            ) : (
              <>
                {materialName ?? "Material"}
                {materialMethod ? ` · ${materialMethod}` : ""}
                {vendorName ? (
                  <span className="hidden sm:inline">{` · ${vendorName}`}</span>
                ) : null}
              </>
            )}
          </p>
          {resumeError && (
            <p role="alert" className="mt-0.5 text-[13px] leading-[18px] text-destructive">
              {resumeError}
            </p>
          )}
        </div>
        {total > 0 && (
          <p className="ml-auto shrink-0 pl-2 text-sm font-medium tabular-nums">
            {formatUsd(total)}
          </p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2 pl-12 sm:pl-0">
        {/* awaiting_production_payment rows are already placed at
            CraftCloud — only cart_created drafts can be discarded
            (matches the guard in discardDraftOrder). */}
        {!awaitingProductionPayment && (
          <Button
            variant="ghost"
            size="sm"
            onClick={handleDiscard}
            loading={pending}
            className="text-muted-foreground"
          >
            Discard
          </Button>
        )}
        <Button size="sm" onClick={handleResume} loading={resuming}>
          {awaitingProductionPayment ? "Complete payment" : "Resume"}
        </Button>
      </div>
    </div>
  );
}
