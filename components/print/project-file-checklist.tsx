"use client";

import Link from "next/link";
import { CheckIcon, LayersIcon } from "lucide-react";
import { ChevronRight } from "@/components/icons/chevron-right";
import { useCart } from "@/components/print/cart-context";

interface ChecklistTile {
  fileAssetId: string;
  name: string;
  thumbnailUrl: string | null;
  format: string;
  source: "owned" | "purchased";
  originalFilename?: string;
  fileSizeBytes?: number;
}

interface ProjectMeta {
  name: string;
  thumbnailUrl: string | null;
  author: { username: string | null; displayName: string | null };
  fileCount: number;
  totalFileSizeBytes: number;
}

interface ProjectFileChecklistProps {
  tiles: ChecklistTile[];
  linkSuffix: string;
  projectMeta?: ProjectMeta;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  return `${(mb / 1024).toFixed(1)} GB`;
}

/**
 * Checklist-style file list for the project print hub. Replaces the
 * WhatNextPane (uploader + collapsible tile list) when the user arrived
 * via "Print this project" — the project files ARE the work items, so
 * the uploader is irrelevant and the list is always expanded.
 *
 * Optionally renders a project info card (thumbnail + name + author +
 * stats) above the file list when `projectMeta` is provided.
 *
 * Each row links to the per-file QuoteConfigurator. Rows already in the
 * cart show a green check + vendor name; rows not yet quoted show a →
 * affordance so the user can tell at a glance what still needs attention.
 */
export function ProjectFileChecklist({
  tiles,
  linkSuffix,
  projectMeta,
}: ProjectFileChecklistProps) {
  const cart = useCart();

  if (tiles.length === 0 && !projectMeta) {
    return (
      <p className="text-sm text-muted-foreground">
        This project has no printable files yet.
      </p>
    );
  }

  const authorLabel =
    projectMeta?.author.displayName ?? projectMeta?.author.username ?? null;

  const inCartCount = tiles.filter((t) =>
    cart?.items.some((i) => i.fileAssetId === t.fileAssetId),
  ).length;

  return (
    <div className="flex flex-col gap-6">
      {projectMeta && (
        <div className="flex items-center gap-3">
          <div className="size-12 shrink-0 overflow-hidden rounded-xl bg-muted">
            {projectMeta.thumbnailUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={projectMeta.thumbnailUrl}
                alt=""
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                <LayersIcon aria-hidden="true" className="size-5" />
              </div>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-base leading-6 font-semibold">
              {projectMeta.name}
            </p>
            <p className="truncate text-[13px] leading-[18px] text-muted-foreground">
              {[
                authorLabel ? `by ${authorLabel}` : null,
                `${projectMeta.fileCount} ${projectMeta.fileCount === 1 ? "file" : "files"}`,
                projectMeta.totalFileSizeBytes > 0
                  ? formatFileSize(projectMeta.totalFileSizeBytes)
                  : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>
        </div>
      )}

      {tiles.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          This project has no printable files yet.
        </p>
      ) : (
        <section>
          <div className="mb-1 flex items-baseline justify-between gap-3">
            <h2 className="text-sm font-medium">Files</h2>
            <p className="text-xs text-subtle-foreground tabular-nums">
              {inCartCount} of {tiles.length} in cart
            </p>
          </div>
          <ul className="-mx-3 flex flex-col">
            {tiles.map((tile) => {
              const cartItem =
                cart?.items.find((i) => i.fileAssetId === tile.fileAssetId) ??
                null;
              const inCart = !!cartItem;
              const vendorName = cartItem?.vendorName ?? null;
              const filenameLabel = tile.originalFilename ?? `.${tile.format}`;

              return (
                <li key={tile.fileAssetId}>
                  <Link
                    href={`/print/${tile.fileAssetId}${linkSuffix}`}
                    className="group flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors duration-150 hover:bg-muted/70"
                  >
                    <div className="relative size-10 shrink-0 overflow-hidden rounded-[10px] bg-muted">
                      {tile.thumbnailUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={tile.thumbnailUrl}
                          alt=""
                          loading="lazy"
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-[10px] font-medium text-subtle-foreground uppercase">
                          {tile.format}
                        </div>
                      )}
                    </div>

                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {tile.name}
                      </p>
                      <p className="truncate text-[13px] leading-[18px] text-muted-foreground">
                        {filenameLabel}
                      </p>
                    </div>

                    {inCart ? (
                      <span className="flex max-w-[45%] shrink-0 items-center gap-1.5 text-[13px] text-success">
                        <CheckIcon
                          aria-hidden="true"
                          className="size-3.5 shrink-0"
                        />
                        <span className="truncate">
                          {vendorName ?? "In cart"}
                        </span>
                      </span>
                    ) : (
                      <span className="flex shrink-0 items-center gap-1 text-[13px] text-muted-foreground group-hover:text-foreground">
                        Get quotes
                        <ChevronRight size={12} />
                      </span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
