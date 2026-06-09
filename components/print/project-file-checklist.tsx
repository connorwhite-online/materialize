"use client";

import Link from "next/link";
import { useCart } from "@/components/print/cart-context";

interface ChecklistTile {
  fileAssetId: string;
  name: string;
  thumbnailUrl: string | null;
  format: string;
  source: "owned" | "purchased";
}

interface ProjectFileChecklistProps {
  tiles: ChecklistTile[];
  linkSuffix: string;
}

/**
 * Checklist-style file list for the project print hub. Replaces the
 * WhatNextPane (uploader + collapsible tile list) when the user arrived
 * via "Print this project" — the project files ARE the work items, so
 * the uploader is irrelevant and the list is always expanded.
 *
 * Each row links to the per-file QuoteConfigurator. Rows already in the
 * cart show a green check + vendor name; rows not yet quoted show a →
 * affordance so the user can tell at a glance what still needs attention.
 */
export function ProjectFileChecklist({
  tiles,
  linkSuffix,
}: ProjectFileChecklistProps) {
  const cart = useCart();

  if (tiles.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        This project has no printable files yet.
      </p>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-card divide-y divide-border overflow-hidden">
      {tiles.map((tile) => {
        // Only DB cart items (authed users) carry a fileAssetId.
        // Local items are anonymous drafts and won't match project files.
        const cartItem =
          cart?.items.find((i) => i.fileAssetId === tile.fileAssetId) ?? null;
        const inCart = !!cartItem;
        const vendorName = cartItem?.vendorName ?? null;

        return (
          <Link
            key={tile.fileAssetId}
            href={`/print/${tile.fileAssetId}${linkSuffix}`}
            className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/40"
          >
            {/* thumbnail */}
            <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded-md border border-border bg-muted">
              {tile.thumbnailUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={tile.thumbnailUrl}
                  alt=""
                  loading="lazy"
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-[9px] uppercase tracking-wider text-muted-foreground/50">
                  .{tile.format}
                </div>
              )}
            </div>

            {/* name + format */}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{tile.name}</p>
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
                .{tile.format}
              </p>
            </div>

            {/* cart status */}
            {inCart ? (
              <div className="flex shrink-0 items-center gap-1.5 text-xs text-green-600 dark:text-green-400">
                <svg
                  width={14}
                  height={14}
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2.5}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M20 6L9 17l-5-5" />
                </svg>
                <span className="truncate max-w-[120px]">
                  {vendorName ?? "In cart"}
                </span>
              </div>
            ) : (
              <span className="shrink-0 text-sm text-muted-foreground">→</span>
            )}
          </Link>
        );
      })}
    </div>
  );
}
