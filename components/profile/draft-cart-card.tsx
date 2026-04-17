"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { discardDraftOrder, resumePrintOrder } from "@/app/actions/print";

interface DraftCartCardProps {
  orderId: string;
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
    startResume(async () => {
      const result = await resumePrintOrder(orderId);
      if ("error" in result) {
        router.push(resumeHref);
        return;
      }
      window.location.href = result.checkoutUrl;
    });
  };

  return (
    <Card className="transition-colors">
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
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleDiscard}
            disabled={pending}
            className="text-destructive"
          >
            {pending ? "…" : "Discard"}
          </Button>
          <Button size="sm" onClick={handleResume} disabled={resuming}>
            {resuming ? "…" : "Resume"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
