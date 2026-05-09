"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
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
  /** Listing owner — gets moderation rights to delete any photo. */
  ownerId: string;
  viewerId: string | null;
}

/**
 * Photos-of-this-file feed. Renders as a bare grid above the
 * comments thread on the file detail page (no header / Card chrome
 * of its own) so they read as one "Discussion" surface — photos
 * above, text comments below.
 *
 * Posting is gated to users who actually downloaded or printed the
 * file. Anonymous viewers see a sign-in CTA; signed-in non-printers
 * see a "print first" CTA pointing at the print page.
 *
 * The internal field/event name is still "make" (`addFileMake` /
 * `notifyMakeOnFile`) — that's a future schema-rename concern.
 * User-visible copy here is "photo of your print".
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
    <div className="space-y-3">
      {canPost ? (
        <div className="flex items-center gap-3">
          <PhotoUploader fileId={fileId} kind="make" />
          <p className="text-xs text-muted-foreground">
            Share a photo of your print
          </p>
        </div>
      ) : !isSignedIn ? (
        <Link
          href={`/sign-in?redirect=${encodeURIComponent(`/files/${fileSlug}`)}`}
          className="block rounded-xl border border-dashed border-border px-4 py-3 text-center text-sm text-muted-foreground hover:bg-muted/40 transition-colors"
        >
          Sign in to share a photo of your print
        </Link>
      ) : (
        <div className="rounded-xl border border-dashed border-border px-4 py-3 text-sm text-muted-foreground">
          <p>Print or download this file first to share a photo.</p>
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

      {makes.length > 0 && (
        <div className="grid gap-3 grid-cols-2 sm:grid-cols-3">
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
    </div>
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
  const [hovering, setHovering] = useState(false);
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
      className="group relative scroll-mt-24 overflow-hidden rounded-xl border border-border bg-card"
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
    >
      <div className="relative aspect-square">
        <img
          src={make.downloadUrl}
          alt={make.caption || "Community print photo"}
          className="w-full h-full object-cover"
        />
        {/* Author byline overlaid on bottom — visible on hover (or
            always on touch devices since hover is unreliable there).
            Caption is intentionally not shown anywhere now that the
            uploader doesn't author them. */}
        <div
          className={`absolute inset-x-0 bottom-0 flex items-center gap-2 bg-gradient-to-t from-black/70 via-black/40 to-transparent px-2.5 py-2 transition-opacity ${
            hovering ? "opacity-100" : "opacity-0 sm:opacity-100"
          }`}
        >
          <UserAvatar
            seed={make.author.username || make.author.id}
            imageUrl={make.author.avatarUrl}
            displayName={
              make.author.displayName || make.author.username || "Anonymous"
            }
            className="h-5 w-5 shrink-0 ring-1 ring-white/40"
          />
          {make.author.username ? (
            <Link
              href={`/u/${make.author.username}`}
              className="truncate text-[11px] font-medium text-white hover:underline"
            >
              {make.author.displayName || make.author.username}
            </Link>
          ) : (
            <span className="truncate text-[11px] font-medium text-white">
              {make.author.displayName || "Anonymous"}
            </span>
          )}
          <span className="ml-auto shrink-0 text-[10px] text-white/70 tabular-nums">
            {timeAgo(make.createdAt)}
          </span>
        </div>
      </div>
      {canDelete && (
        <button
          type="button"
          onClick={handleDelete}
          disabled={pending}
          aria-label="Delete photo"
          className="absolute right-2 top-2 inline-flex items-center justify-center rounded-md bg-black/50 p-1.5 text-white opacity-0 transition-opacity hover:bg-destructive group-hover:opacity-100 focus-visible:opacity-100 disabled:opacity-50"
        >
          <Trash className="size-3.5" />
        </button>
      )}
    </div>
  );
}
