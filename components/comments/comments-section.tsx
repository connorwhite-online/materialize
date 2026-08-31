"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { UserAvatar } from "@/components/auth/user-avatar";
import { Pencil } from "@/components/icons/pencil";
import { Trash } from "@/components/icons/trash";
import { CommentForm } from "./comment-form";
import { DiscussionEmptyBanner } from "./discussion-empty-banner";
import { DeletePhotoButton } from "@/components/photos/delete-photo-button";
import { PhotoLightbox } from "@/components/photos/photo-lightbox";
import { MarkdownProse } from "@/components/ui/markdown-prose";
import {
  deleteComment,
  editComment,
  type CommentTarget,
} from "@/app/actions/comments";
import { timeAgo } from "@/lib/utils/time";
import { Textarea } from "@/components/ui/textarea";
import { MAX_COMMENT_LENGTH } from "@/lib/validations/comment";

export type CommentRow = {
  id: string;
  parentId: string | null;
  body: string;
  deletedAt: Date | string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
  author: {
    id: string;
    username: string | null;
    displayName: string | null;
    avatarUrl: string | null;
  };
};

export type PhotoPost = {
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
  target: CommentTarget;
  targetId: string;
  /**
   * Pre-fetched comments — both top-level and replies. Component
   * groups them by `parentId` client-side; server-side ordering is
   * `createdAt asc` so threads read top-down.
   */
  comments: CommentRow[];
  /**
   * Photo posts (community make photos) interleaved with top-level
   * text comments by createdAt. Replies still nest under their
   * parent text comment; photo posts have no replies in v1.
   */
  photoPosts?: PhotoPost[];
  ownerId: string;
  viewerId: string | null;
  /** When true, show composer; otherwise show sign-in CTA. */
  isSignedIn: boolean;
  signInRedirect: string;
  /**
   * When true, the composer surfaces an "attach photo" affordance —
   * posting with a photo routes through the addInline*CommentPhoto
   * action for the appropriate target type. Works on both file and
   * project detail pages.
   */
  acceptPhoto?: boolean;
}

type FeedItem =
  | { kind: "comment"; data: CommentRow; replies: CommentRow[] }
  | { kind: "photo"; data: PhotoPost };

export function CommentsSection({
  target,
  targetId,
  comments,
  photoPosts = [],
  ownerId,
  viewerId,
  isSignedIn,
  signInRedirect,
  acceptPhoto = false,
}: Props) {
  // Empty discussion starts collapsed behind the banner so the
  // section stays a light invitation instead of a full composer.
  const [composing, setComposing] = useState(false);

  const topLevel = comments.filter((c) => c.parentId === null);
  const repliesByParent = new Map<string, CommentRow[]>();
  for (const c of comments) {
    if (c.parentId) {
      const arr = repliesByParent.get(c.parentId) ?? [];
      arr.push(c);
      repliesByParent.set(c.parentId, arr);
    }
  }

  // Interleave top-level text comments with photo posts by createdAt
  // ascending so the conversation reads top-down (matches the
  // existing comment ordering).
  const items: FeedItem[] = [
    ...topLevel.map<FeedItem>((c) => ({
      kind: "comment",
      data: c,
      replies: repliesByParent.get(c.id) ?? [],
    })),
    ...photoPosts.map<FeedItem>((p) => ({ kind: "photo", data: p })),
  ].sort((a, b) => {
    const aT = new Date(a.data.createdAt).getTime();
    const bT = new Date(b.data.createdAt).getTime();
    return aT - bT;
  });

  const signInHref = `/sign-in?redirect=${encodeURIComponent(signInRedirect)}`;

  if (items.length === 0) {
    // Owners don't need an invitation on their own empty listing —
    // the whole Discussion section is omitted (call sites skip the
    // heading when CommentsSection returns null).
    if (viewerId !== null && viewerId === ownerId) {
      return null;
    }

    return (
      <div className="space-y-4">
        {!composing && (
          <DiscussionEmptyBanner
            onStart={isSignedIn ? () => setComposing(true) : undefined}
            signInHref={isSignedIn ? undefined : signInHref}
          />
        )}
        {isSignedIn && composing && (
          <CommentForm
            target={target}
            targetId={targetId}
            placeholder="Share thoughts on this listing…"
            acceptPhoto={acceptPhoto}
            autoFocus
            onCancel={() => setComposing(false)}
          />
        )}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {isSignedIn ? (
        <CommentForm
          target={target}
          targetId={targetId}
          placeholder="Share thoughts on this listing…"
          acceptPhoto={acceptPhoto}
        />
      ) : (
        <Link
          href={signInHref}
          className="block rounded-xl border border-dashed border-border px-4 py-3 text-center text-sm text-muted-foreground hover:bg-muted/40 transition-colors"
        >
          Sign in to comment
        </Link>
      )}

      <div className="space-y-5">
        {items.map((item) =>
          item.kind === "comment" ? (
            <CommentThread
              key={`c-${item.data.id}`}
              target={target}
              targetId={targetId}
              comment={item.data}
              replies={item.replies}
              ownerId={ownerId}
              viewerId={viewerId}
              canReply={isSignedIn}
            />
          ) : (
            <PhotoPostRow
              key={`p-${item.data.id}`}
              target={target}
              photo={item.data}
              ownerId={ownerId}
              viewerId={viewerId}
            />
          )
        )}
      </div>
    </div>
  );
}

function PhotoPostRow({
  target,
  photo,
  ownerId,
  viewerId,
}: {
  target: CommentTarget;
  photo: PhotoPost;
  ownerId: string;
  viewerId: string | null;
}) {
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const canDelete =
    viewerId !== null && (viewerId === photo.author.id || viewerId === ownerId);
  const name = photo.author.displayName || photo.author.username || "Anonymous";

  return (
    <div
      id={`build-${photo.id}`}
      className="flex scroll-mt-24 items-start gap-3"
    >
      <UserAvatar
        seed={photo.author.username || photo.author.id}
        imageUrl={photo.author.avatarUrl}
        displayName={name}
        className="h-8 w-8 shrink-0"
      />
      <div className="flex-1 min-w-0 space-y-1.5">
        <div className="flex items-baseline gap-2">
          {photo.author.username ? (
            <Link
              href={`/${photo.author.username}`}
              className="text-sm font-medium hover:underline"
            >
              {photo.author.displayName || photo.author.username}
            </Link>
          ) : (
            <span className="text-sm font-medium">
              {photo.author.displayName || "Anonymous"}
            </span>
          )}
          <span className="text-xs text-muted-foreground">
            {timeAgo(photo.createdAt)}
          </span>
        </div>
        <div className="relative inline-block max-w-full">
          <button
            type="button"
            onClick={() => setLightboxOpen(true)}
            className="block max-w-full overflow-hidden rounded-xl border border-border bg-muted/30 transition-opacity hover:opacity-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring cursor-pointer"
            aria-label={photo.caption || "View photo"}
          >
            <img
              src={photo.downloadUrl}
              alt={photo.caption || ""}
              loading="lazy"
              decoding="async"
              className="block max-h-80 max-w-full object-contain"
            />
          </button>
          {canDelete && (
            <DeletePhotoButton photoId={photo.id} targetType={target} />
          )}
        </div>
        {photo.caption && (
          <p className="text-sm whitespace-pre-wrap break-words">
            {photo.caption}
          </p>
        )}
      </div>

      {lightboxOpen && (
        <PhotoLightbox
          photos={[
            {
              id: photo.id,
              downloadUrl: photo.downloadUrl,
              caption: photo.caption,
            },
          ]}
          index={0}
          onClose={() => setLightboxOpen(false)}
          onIndexChange={() => {
            /* single photo */
          }}
        />
      )}
    </div>
  );
}

function CommentThread({
  target,
  targetId,
  comment,
  replies,
  ownerId,
  viewerId,
  canReply,
}: {
  target: CommentTarget;
  targetId: string;
  comment: CommentRow;
  replies: CommentRow[];
  ownerId: string;
  viewerId: string | null;
  canReply: boolean;
}) {
  const [replyOpen, setReplyOpen] = useState(false);
  return (
    <div className="space-y-3">
      <CommentRow
        target={target}
        comment={comment}
        ownerId={ownerId}
        viewerId={viewerId}
        canReply={canReply}
        onReply={() => setReplyOpen(true)}
      />
      {(replies.length > 0 || replyOpen) && (
        <div className="ml-10 space-y-3 border-l border-border pl-4">
          {replies.map((r) => (
            <CommentRow
              key={r.id}
              target={target}
              comment={r}
              ownerId={ownerId}
              viewerId={viewerId}
              canReply={false}
            />
          ))}
          {replyOpen && (
            <CommentForm
              target={target}
              targetId={targetId}
              parentId={comment.id}
              autoFocus
              placeholder="Write a reply…"
              onPosted={() => setReplyOpen(false)}
              onCancel={() => setReplyOpen(false)}
            />
          )}
        </div>
      )}
    </div>
  );
}

function CommentRow({
  target,
  comment,
  ownerId,
  viewerId,
  canReply,
  onReply,
}: {
  target: CommentTarget;
  comment: CommentRow;
  ownerId: string;
  viewerId: string | null;
  canReply: boolean;
  onReply?: () => void;
}) {
  const isAuthor = viewerId === comment.author.id;
  const isOwner = viewerId === ownerId;
  const canDelete = !comment.deletedAt && (isAuthor || isOwner);
  const canEdit = !comment.deletedAt && isAuthor;

  const [editing, setEditing] = useState(false);

  if (comment.deletedAt) {
    return (
      <div
        id={`comment-${comment.id}`}
        className="flex scroll-mt-24 items-start gap-3 text-sm text-muted-foreground"
      >
        <UserAvatar
          seed={comment.author.username || comment.author.id}
          imageUrl={null}
          displayName="[deleted]"
          className="h-8 w-8"
        />
        <div className="flex-1 pt-1 italic">[deleted]</div>
      </div>
    );
  }

  return (
    <div
      id={`comment-${comment.id}`}
      className="flex scroll-mt-24 items-start gap-3"
    >
      <UserAvatar
        seed={comment.author.username || comment.author.id}
        imageUrl={comment.author.avatarUrl}
        displayName={
          comment.author.displayName || comment.author.username || "Anonymous"
        }
        className="h-8 w-8 shrink-0"
      />
      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex items-baseline gap-2">
          {comment.author.username ? (
            <Link
              href={`/${comment.author.username}`}
              className="text-sm font-medium hover:underline"
            >
              {comment.author.displayName || comment.author.username}
            </Link>
          ) : (
            <span className="text-sm font-medium">
              {comment.author.displayName || "Anonymous"}
            </span>
          )}
          <span className="text-xs text-muted-foreground">
            {timeAgo(comment.createdAt)}
          </span>
        </div>
        {editing ? (
          <EditInline
            target={target}
            commentId={comment.id}
            initial={comment.body}
            onDone={() => setEditing(false)}
          />
        ) : (
          <MarkdownProse>{comment.body}</MarkdownProse>
        )}
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {canReply && onReply && (
            <button
              type="button"
              onClick={onReply}
              className="hover:text-foreground transition-colors cursor-pointer"
            >
              Reply
            </button>
          )}
          {canEdit && !editing && (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="inline-flex items-center gap-1 hover:text-foreground transition-colors cursor-pointer"
              aria-label="Edit comment"
            >
              <Pencil className="size-3.5" />
              Edit
            </button>
          )}
          {canDelete && (
            <DeleteButton target={target} commentId={comment.id} />
          )}
        </div>
      </div>
    </div>
  );
}

function EditInline({
  target,
  commentId,
  initial,
  onDone,
}: {
  target: CommentTarget;
  commentId: string;
  initial: string;
  onDone: () => void;
}) {
  const router = useRouter();
  const [body, setBody] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = () => {
    const trimmed = body.trim();
    if (!trimmed || pending) return;
    setError(null);
    startTransition(async () => {
      const res = await editComment(target, commentId, { body: trimmed });
      if ("error" in res) {
        setError(res.error);
        return;
      }
      onDone();
      router.refresh();
    });
  };

  return (
    <div className="space-y-2">
      <Textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        maxLength={MAX_COMMENT_LENGTH}
        autoFocus
        className="min-h-20"
      />
      {error && <p className="text-xs text-destructive">{error}</p>}
      <div className="flex items-center justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onDone} disabled={pending}>
          Cancel
        </Button>
        <Button
          size="sm"
          onClick={submit}
          disabled={pending || body.trim().length === 0 || body.trim() === initial}
        >
          {pending ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  );
}

function DeleteButton({
  target,
  commentId,
}: {
  target: CommentTarget;
  commentId: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      onClick={() => {
        if (pending) return;
        startTransition(async () => {
          const res = await deleteComment(target, commentId);
          if ("error" in res) return; // silent — owner-vs-author safety
          router.refresh();
        });
      }}
      className="inline-flex items-center gap-1 hover:text-destructive transition-colors cursor-pointer"
      aria-label="Delete comment"
      disabled={pending}
    >
      <Trash className="size-3.5" />
      Delete
    </button>
  );
}
