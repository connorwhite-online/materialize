"use client";

import Link from "next/link";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { discardDraftOrder } from "@/app/actions/print";

interface DraftCartCardProps {
  orderId: string;
  fileAssetId: string | null;
  fileName: string | null;
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
  materialId,
  materialName,
  materialMethod,
  materialColor,
  total,
}: DraftCartCardProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const resumeHref =
    fileAssetId && materialId
      ? `/print/${fileAssetId}?material=${materialId}`
      : fileAssetId
        ? `/print/${fileAssetId}`
        : "/print";

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
          <Button size="sm" render={<Link href={resumeHref} />}>
            Resume
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
