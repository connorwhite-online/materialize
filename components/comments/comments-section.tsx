"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { UserAvatar } from "@/components/auth/user-avatar";
import { Pencil } from "@/components/icons/pencil";
import { Trash } from "@/components/icons/trash";
import { CommentForm } from "./comment-form";
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

interface Props {
  target: CommentTarget;
  targetId: string;
  /**
   * Pre-fetched comments — both top-level and replies. Component
   * groups them by `parentId` client-side; server-side ordering is
   * `createdAt asc` so threads read top-down.
   */
  comments: CommentRow[];
  ownerId: string;
  viewerId: string | null;
  /** When true, show composer; otherwise show sign-in CTA. */
  isSignedIn: boolean;
  signInRedirect: string;
}

export function CommentsSection({
  target,
  targetId,
  comments,
  ownerId,
  viewerId,
  isSignedIn,
  signInRedirect,
}: Props) {
  const topLevel = comments.filter((c) => c.parentId === null);
  const repliesByParent = new Map<string, CommentRow[]>();
  for (const c of comments) {
    if (c.parentId) {
      const arr = repliesByParent.get(c.parentId) ?? [];
      arr.push(c);
      repliesByParent.set(c.parentId, arr);
    }
  }

  return (
    <div className="space-y-5">
      {isSignedIn ? (
        <CommentForm
          target={target}
          targetId={targetId}
          placeholder="Share thoughts on this listing…"
        />
      ) : (
        <Link
          href={`/sign-in?redirect=${encodeURIComponent(signInRedirect)}`}
          className="block rounded-xl border border-dashed border-border px-4 py-3 text-center text-sm text-muted-foreground hover:bg-muted/40 transition-colors"
        >
          Sign in to comment
        </Link>
      )}

      {topLevel.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          No comments yet.
        </p>
      ) : (
        <div className="space-y-5">
          {topLevel.map((c) => (
            <CommentThread
              key={c.id}
              target={target}
              targetId={targetId}
              comment={c}
              replies={repliesByParent.get(c.id) ?? []}
              ownerId={ownerId}
              viewerId={viewerId}
              canReply={isSignedIn}
            />
          ))}
        </div>
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
              href={`/u/${comment.author.username}`}
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
          <p className="text-sm whitespace-pre-wrap break-words">
            {comment.body}
          </p>
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
