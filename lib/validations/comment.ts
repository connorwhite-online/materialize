import { z } from "zod";

// Hard cap on comment body length. ~5000 chars is roughly a long
// comment (a printable single page) — anything past that is almost
// certainly a paste-bomb and not a useful discussion contribution.
export const MAX_COMMENT_LENGTH = 5000;

export const postCommentSchema = z.object({
  body: z.string().trim().min(1, "Comment can't be empty").max(MAX_COMMENT_LENGTH),
  parentId: z.string().uuid().optional(),
});

export const editCommentSchema = z.object({
  body: z.string().trim().min(1, "Comment can't be empty").max(MAX_COMMENT_LENGTH),
});

export type PostCommentInput = z.infer<typeof postCommentSchema>;
export type EditCommentInput = z.infer<typeof editCommentSchema>;
