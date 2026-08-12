"use client";

import { useState } from "react";
import Link from "next/link";
import { BoxIcon, LayersIcon, FolderOpenIcon, ArrowRightIcon } from "lucide-react";
import { UploadDialog } from "@/components/upload/upload-dialog";
import { NewCollectionDialog } from "./new-collection-dialog";

/**
 * First-run empty state for the owner's library. Replaces the old
 * single "Upload your first file" button with three explanatory cards
 * that lay out the File → Project / Collection hierarchy so a new
 * creator understands what each primitive is before picking one:
 *
 *   - File:       the atom — one uploaded 3D model.
 *   - Project:    a bundle of files sold as a single unit.
 *   - Collection: a shelf that groups files for browsing.
 *
 * File and Collection open their existing controlled dialogs in place;
 * Project links to /projects/new (it needs uploaded files to bundle,
 * which the card's subtext calls out).
 */
export function LibraryEmptyState({ compact = false }: { compact?: boolean }) {
  const [uploadOpen, setUploadOpen] = useState(false);
  const [collectionOpen, setCollectionOpen] = useState(false);

  return (
    <div
      className={
        compact
          ? "rounded-2xl bg-muted/50 px-4 py-8"
          : "rounded-2xl bg-muted/50 px-5 py-12 sm:px-8 sm:py-16"
      }
    >
      <div className="mx-auto max-w-2xl text-center">
        <h2 className="font-heading text-lg font-medium">
          Your library is empty
        </h2>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Everything starts with a file. Bundle files into projects to sell,
          or group them into collections to organize.
        </p>
      </div>

      <div
        className={
          compact
            ? "mt-5 grid grid-cols-3 gap-2"
            : "mx-auto mt-8 grid max-w-3xl gap-3 sm:grid-cols-3"
        }
      >
        <EmptyStateCard
          compact={compact}
          icon={<BoxIcon className={compact ? "size-4" : "size-5"} />}
          title="File"
          description="A single 3D model — STL, OBJ, 3MF, STEP or AMF. The building block everything else is made from."
          cta="Upload a file"
          onClick={() => setUploadOpen(true)}
        />
        <EmptyStateCard
          compact={compact}
          icon={<LayersIcon className={compact ? "size-4" : "size-5"} />}
          title="Project"
          description="Bundle several files into one sellable unit, like a multi-part model. Built from files you've uploaded."
          cta="Start a project"
          href="/projects/new"
        />
        <EmptyStateCard
          compact={compact}
          icon={<FolderOpenIcon className={compact ? "size-4" : "size-5"} />}
          title="Collection"
          description="Group related files into a shelf to organize your profile. For browsing, not a product."
          cta="New collection"
          onClick={() => setCollectionOpen(true)}
        />
      </div>

      <UploadDialog open={uploadOpen} onOpenChange={setUploadOpen} />
      <NewCollectionDialog
        open={collectionOpen}
        onOpenChange={setCollectionOpen}
      />
    </div>
  );
}

interface EmptyStateCardProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  cta: string;
  onClick?: () => void;
  href?: string;
  compact?: boolean;
}

function EmptyStateCard({
  icon,
  title,
  description,
  cta,
  onClick,
  href,
  compact = false,
}: EmptyStateCardProps) {
  const inner = (
    <>
      <span
        className={
          compact
            ? "flex size-8 items-center justify-center rounded-full bg-primary/10 text-primary"
            : "flex size-10 items-center justify-center rounded-full bg-primary/10 text-primary"
        }
      >
        {icon}
      </span>
      <span
        className={
          compact
            ? "mt-2 font-heading text-sm font-medium"
            : "mt-3 font-heading text-base font-medium"
        }
      >
        {title}
      </span>
      <span
        className={
          compact
            ? "mt-1 line-clamp-3 text-xs text-muted-foreground"
            : "mt-1 text-sm text-muted-foreground"
        }
      >
        {description}
      </span>
      <span
        className={
          compact
            ? "mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary"
            : "mt-3 inline-flex items-center gap-1 text-sm font-medium text-primary"
        }
      >
        {cta}
        <ArrowRightIcon className="size-3.5 transition-transform group-hover/empty-card:translate-x-0.5" />
      </span>
    </>
  );

  const className = compact
    ? "group/empty-card depth-surface flex h-full flex-col rounded-lg bg-card p-3 text-left ring-1 ring-foreground/10 transition-colors hover:bg-card/80 hover:ring-foreground/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    : "group/empty-card depth-surface flex h-full flex-col rounded-xl bg-card p-4 text-left ring-1 ring-foreground/10 transition-colors hover:bg-card/80 hover:ring-foreground/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

  if (href) {
    return (
      <Link href={href} className={className}>
        {inner}
      </Link>
    );
  }

  return (
    <button type="button" onClick={onClick} className={className}>
      {inner}
    </button>
  );
}
