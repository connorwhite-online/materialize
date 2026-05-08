import Link from "next/link";
import { db } from "@/lib/db";
import {
  fileComments,
  projectComments,
  files,
  projects,
  users,
} from "@/lib/db/schema";
import { eq, desc, and, isNull } from "drizzle-orm";
import { Card, CardContent } from "@/components/ui/card";
import { UserAvatar } from "@/components/auth/user-avatar";
import { timeAgo } from "@/lib/utils/time";
import { swallow } from "@/lib/utils/swallow";

const INBOX_LIMIT = 50;

/**
 * Owner-only "recent comments on your listings" view.
 *
 * Unions file + project comments that target a listing the viewer
 * created. Both halves are queried in parallel via swallow() so a
 * transient Neon hiccup on one doesn't 500 the whole tab. Soft-deleted
 * comments are filtered out — owners shouldn't see their own deletions
 * lingering in the inbox.
 *
 * No unread state in v1 — see the plan; we'll add a per-row read
 * marker if/when notifications become a real feature.
 */
export async function CommentsInboxTab({ userId }: { userId: string }) {
  const [fileRows, projectRows] = await Promise.all([
    swallow(
      db
        .select({
          id: fileComments.id,
          body: fileComments.body,
          createdAt: fileComments.createdAt,
          listingName: files.name,
          listingSlug: files.slug,
          authorId: users.id,
          authorUsername: users.username,
          authorDisplayName: users.displayName,
          authorAvatarUrl: users.avatarUrl,
        })
        .from(fileComments)
        .innerJoin(files, eq(fileComments.fileId, files.id))
        .innerJoin(users, eq(fileComments.userId, users.id))
        .where(
          and(eq(files.userId, userId), isNull(fileComments.deletedAt))
        )
        .orderBy(desc(fileComments.createdAt))
        .limit(INBOX_LIMIT)
    ),
    swallow(
      db
        .select({
          id: projectComments.id,
          body: projectComments.body,
          createdAt: projectComments.createdAt,
          listingName: projects.name,
          listingSlug: projects.slug,
          authorId: users.id,
          authorUsername: users.username,
          authorDisplayName: users.displayName,
          authorAvatarUrl: users.avatarUrl,
        })
        .from(projectComments)
        .innerJoin(projects, eq(projectComments.projectId, projects.id))
        .innerJoin(users, eq(projectComments.userId, users.id))
        .where(
          and(
            eq(projects.userId, userId),
            isNull(projectComments.deletedAt)
          )
        )
        .orderBy(desc(projectComments.createdAt))
        .limit(INBOX_LIMIT)
    ),
  ]);

  const merged = [
    ...fileRows.map((r) => ({ ...r, kind: "file" as const })),
    ...projectRows.map((r) => ({ ...r, kind: "project" as const })),
  ]
    .sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    )
    .slice(0, INBOX_LIMIT);

  // Skip the comment author's own listing-self-comments in the inbox —
  // those aren't really "messages from someone else" and only add noise.
  const incoming = merged.filter((r) => r.authorId !== userId);

  if (incoming.length === 0) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          No comments on your listings yet.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="gap-0 py-0 overflow-hidden">
      <div>
        {incoming.map((row) => {
          const href =
            row.kind === "file"
              ? `/files/${row.listingSlug}`
              : `/projects/${row.listingSlug}`;
          const name =
            row.authorDisplayName || row.authorUsername || "Anonymous";
          return (
            <Link
              key={`${row.kind}-${row.id}`}
              href={href}
              className="flex items-start gap-3 border-b border-border/60 px-4 py-3 last:border-b-0 hover:bg-muted/40 transition-colors"
            >
              <UserAvatar
                seed={row.authorUsername || row.authorId}
                imageUrl={row.authorAvatarUrl}
                displayName={name}
                className="h-8 w-8 shrink-0"
              />
              <div className="flex-1 min-w-0 space-y-0.5">
                <div className="flex items-baseline gap-2 text-sm">
                  <span className="font-medium truncate">{name}</span>
                  <span className="text-xs text-muted-foreground">on</span>
                  <span className="text-xs font-medium text-muted-foreground truncate">
                    {row.listingName}
                  </span>
                  <span className="ml-auto text-xs text-muted-foreground tabular-nums shrink-0">
                    {timeAgo(row.createdAt)}
                  </span>
                </div>
                <p className="text-sm text-muted-foreground line-clamp-2">
                  {row.body}
                </p>
              </div>
            </Link>
          );
        })}
      </div>
    </Card>
  );
}
