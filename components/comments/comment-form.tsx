"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { postComment, type CommentTarget } from "@/app/actions/comments";
import { MAX_COMMENT_LENGTH } from "@/lib/validations/comment";

interface Props {
  target: CommentTarget;
  targetId: string;
  parentId?: string;
  /** Called when post succeeds — used by reply forms to collapse. */
  onPosted?: () => void;
  /** Called when user clicks Cancel on a reply form. */
  onCancel?: () => void;
  placeholder?: string;
  autoFocus?: boolean;
}

/**
 * Tiny composer used both for top-level posts and inline replies.
 *
 * Submission re-renders the page via `router.refresh()` to surface the
 * new row through Next's normal data fetching, rather than juggling
 * client-side optimistic state. The action is fast enough on the
 * happy path (single insert + revalidatePath) that the user sees the
 * new comment within a tick or two of the click.
 */
export function CommentForm({
  target,
  targetId,
  parentId,
  onPosted,
  onCancel,
  placeholder = "Share your thoughts…",
  autoFocus = false,
}: Props) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = () => {
    const trimmed = body.trim();
    if (!trimmed || pending) return;
    setError(null);
    startTransition(async () => {
      const res = await postComment(target, targetId, {
        body: trimmed,
        parentId,
      });
      if ("error" in res) {
        setError(res.error);
        return;
      }
      setBody("");
      onPosted?.();
      router.refresh();
    });
  };

  return (
    <div className="space-y-2">
      <Textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder={placeholder}
        maxLength={MAX_COMMENT_LENGTH}
        autoFocus={autoFocus}
        className="min-h-20"
        onKeyDown={(e) => {
          // Cmd/Ctrl-Enter submits — common pattern for any inline
          // composer, lets keyboard users post without reaching for
          // the mouse.
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
            e.preventDefault();
            submit();
          }
        }}
      />
      {error && <p className="text-xs text-destructive">{error}</p>}
      <div className="flex items-center justify-end gap-2">
        {onCancel && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onCancel}
            disabled={pending}
          >
            Cancel
          </Button>
        )}
        <Button
          size="sm"
          onClick={submit}
          disabled={pending || body.trim().length === 0}
        >
          {pending ? "Posting…" : parentId ? "Reply" : "Post"}
        </Button>
      </div>
    </div>
  );
}
