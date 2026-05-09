"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Trash } from "@/components/icons/trash";
import { UserAvatar } from "@/components/auth/user-avatar";
import { PhotoUploader } from "./photo-uploader";
import { deleteFilePhoto } from "@/app/actions/photos";
import { timeAgo } from "@/lib/utils/time";

export type MakeRow = {
  id: string;
  caption: string | null;
  downloadUrl: string;
  createdAt: Date | string;
  author: {
    id: string;
    username: string | null;
    displayName: string | null;
    avatarUrl: string | null;
  };
};

interface Props {
  fileId: string;
  fileSlug: string;
  makes: MakeRow[];
  /** Has the viewer downloaded or printed the file? */
  canPost: boolean;
  isSignedIn: boolean;
  /** Print page link to surface in the empty / locked state. */
  primaryAssetId: string | null;
  /** Listing owner — gets moderation rights to delete any make. */
  ownerId: string;
  viewerId: string | null;
}

/**
 * Community-makes section. Sits below the curator gallery on the file
 * detail page. Posting is gated to users who have actually downloaded
 * or printed the file (`canPost`); everyone else sees the empty state
 * with a CTA pointing to the action that would unlock posting (sign in
 * or print).
 */
export function MakesSection({
  fileId,
  fileSlug,
  makes,
  canPost,
  isSignedIn,
  primaryAssetId,
  ownerId,
  viewerId,
}: Props) {
  return (
    <Card>
      <CardContent className="space-y-4">
        <div>
          <h2 className="text-base font-semibold">
            Makes
            <span className="ml-2 text-sm font-normal text-muted-foreground tabular-nums">
              {makes.length}
            </span>
          </h2>
          <p className="text-xs text-muted-foreground">
            Community-printed photos of this file.
          </p>
        </div>

        {canPost ? (
          <PhotoUploader fileId={fileId} kind="make" />
        ) : !isSignedIn ? (
          <Link
            href={`/sign-in?redirect=${encodeURIComponent(`/files/${fileSlug}`)}`}
            className="block rounded-xl border border-dashed border-border px-4 py-3 text-center text-sm text-muted-foreground hover:bg-muted/40 transition-colors"
          >
            Sign in to share your make
          </Link>
        ) : (
          <div className="rounded-xl border border-dashed border-border px-4 py-3 text-sm text-muted-foreground">
            <p>Print or download this file first to share your make.</p>
            {primaryAssetId && (
              <Button
                variant="secondary"
                size="sm"
                className="mt-2"
                render={<Link href={`/print/${primaryAssetId}`} />}
              >
                Print this file
              </Button>
            )}
          </div>
        )}

        {makes.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No makes yet. Be the first to share one.
          </p>
        ) : (
          <div className="grid gap-3 grid-cols-1 sm:grid-cols-2">
            {makes.map((m) => (
              <MakeCard
                key={m.id}
                make={m}
                viewerId={viewerId}
                ownerId={ownerId}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function MakeCard({
  make,
  viewerId,
  ownerId,
}: {
  make: MakeRow;
  viewerId: string | null;
  ownerId: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const canDelete =
    viewerId !== null &&
    (viewerId === make.author.id || viewerId === ownerId);

  const handleDelete = () => {
    if (pending) return;
    startTransition(async () => {
      const res = await deleteFilePhoto(make.id);
      if ("error" in res) return;
      router.refresh();
    });
  };

  return (
    <div
      id={`make-${make.id}`}
      className="scroll-mt-24 overflow-hidden rounded-xl border border-border bg-card"
    >
      <div className="relative aspect-[4/3]">
        <img
          src={make.downloadUrl}
          alt={make.caption || "Community print photo"}
          className="w-full h-full object-cover"
        />
      </div>
      <div className="space-y-2 p-3">
        <div className="flex items-center gap-2 min-w-0">
          <UserAvatar
            seed={make.author.username || make.author.id}
            imageUrl={make.author.avatarUrl}
            displayName={
              make.author.displayName || make.author.username || "Anonymous"
            }
            className="h-6 w-6 shrink-0"
          />
          {make.author.username ? (
            <Link
              href={`/u/${make.author.username}`}
              className="text-xs font-medium truncate hover:underline"
            >
              {make.author.displayName || make.author.username}
            </Link>
          ) : (
            <span className="text-xs font-medium truncate">
              {make.author.displayName || "Anonymous"}
            </span>
          )}
          <span className="ml-auto text-xs text-muted-foreground tabular-nums shrink-0">
            {timeAgo(make.createdAt)}
          </span>
        </div>
        {make.caption && (
          <p className="text-xs text-muted-foreground line-clamp-3">
            {make.caption}
          </p>
        )}
        {canDelete && (
          <button
            type="button"
            onClick={handleDelete}
            disabled={pending}
            aria-label="Delete make"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-destructive transition-colors cursor-pointer disabled:opacity-50"
          >
            <Trash className="size-3.5" />
            {pending ? "Deleting…" : "Delete"}
          </button>
        )}
      </div>
    </div>
  );
}
