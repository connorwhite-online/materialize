"use client";

import Link from "next/link";
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

  return (
    <div className="space-y-2 rounded-xl bg-muted/40 p-2">
      {/* Project info card */}
      {projectMeta && (
        <div className="flex items-center gap-3 rounded-xl border border-border bg-card p-3">
          <div className="h-14 w-14 shrink-0 overflow-hidden rounded-lg border border-border bg-muted">
            {projectMeta.thumbnailUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={projectMeta.thumbnailUrl}
                alt=""
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center">
                <svg
                  width={20}
                  height={20}
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.5}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="text-muted-foreground/40"
                  aria-hidden="true"
                >
                  <rect x="3" y="3" width="18" height="18" rx="2" />
                  <path d="M3 9h18" />
                  <path d="M9 21V9" />
                </svg>
              </div>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{projectMeta.name}</p>
            {authorLabel && (
              <p className="text-xs text-muted-foreground">by {authorLabel}</p>
            )}
            <p className="text-xs text-muted-foreground">
              {projectMeta.fileCount}{" "}
              {projectMeta.fileCount === 1 ? "file" : "files"}
              {projectMeta.totalFileSizeBytes > 0 &&
                ` · ${formatFileSize(projectMeta.totalFileSizeBytes)}`}
            </p>
          </div>
        </div>
      )}

      {/* File checklist */}
      {tiles.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          This project has no printable files yet.
        </p>
      ) : (
        <div className="rounded-xl border border-border bg-card divide-y divide-border overflow-hidden">
          {tiles.map((tile) => {
            // Only DB cart items (authed users) carry a fileAssetId.
            // Local items are anonymous drafts and won't match project files.
            const cartItem =
              cart?.items.find((i) => i.fileAssetId === tile.fileAssetId) ??
              null;
            const inCart = !!cartItem;
            const vendorName = cartItem?.vendorName ?? null;

            const filenameLabel =
              tile.originalFilename ?? `.${tile.format}`;

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

                {/* name + filename */}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{tile.name}</p>
                  <p className="truncate text-[11px] text-muted-foreground">
                    {filenameLabel}
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
                  <span className="shrink-0 text-sm text-muted-foreground">
                    →
                  </span>
                )}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
