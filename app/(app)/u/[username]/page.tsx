import { notFound } from "next/navigation";
import Link from "next/link";
import { db } from "@/lib/db";
import { users, files } from "@/lib/db/schema";
import { eq, and, desc } from "drizzle-orm";

const PLATFORM_LABELS: Record<string, string> = {
  twitter: "X / Twitter",
  github: "GitHub",
  instagram: "Instagram",
  youtube: "YouTube",
  linkedin: "LinkedIn",
  website: "Website",
};

export default async function UserProfilePage(props: {
  params: Promise<{ username: string }>;
}) {
  const { username } = await props.params;

  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.username, username));

  if (!user) notFound();

  const userFiles = await db
    .select()
    .from(files)
    .where(and(eq(files.userId, user.id), eq(files.status, "published")))
    .orderBy(desc(files.createdAt));

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <div className="flex items-start gap-6">
        {user.avatarUrl && (
          <img
            src={user.avatarUrl}
            alt=""
            className="h-20 w-20 rounded-full"
          />
        )}
        <div>
          <h1 className="text-2xl font-bold">
            {user.displayName || user.username}
          </h1>
          {user.username && (
            <p className="text-foreground/60">@{user.username}</p>
          )}
          {user.bio && <p className="mt-2 max-w-xl">{user.bio}</p>}
          {user.socialLinks && user.socialLinks.length > 0 && (
            <div className="mt-3 flex gap-3">
              {user.socialLinks.map((link) => (
                <a
                  key={link.platform}
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-foreground/60 underline hover:text-foreground"
                >
                  {PLATFORM_LABELS[link.platform] || link.platform}
                </a>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="mt-8">
        <h2 className="text-lg font-semibold">
          Files ({userFiles.length})
        </h2>
        {userFiles.length === 0 ? (
          <p className="mt-4 text-foreground/60">No published files yet.</p>
        ) : (
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {userFiles.map((file) => (
              <Link
                key={file.id}
                href={`/files/${file.slug}`}
                className="group rounded-lg border border-foreground/10 p-4 transition-colors hover:border-foreground/20"
              >
                <div className="aspect-square rounded-md bg-foreground/5" />
                <h3 className="mt-3 font-medium group-hover:underline">
                  {file.name}
                </h3>
                <div className="mt-1 text-sm">
                  {file.price > 0 ? (
                    <span className="font-medium">
                      ${(file.price / 100).toFixed(2)}
                    </span>
                  ) : (
                    <span className="text-foreground/60">Free</span>
                  )}
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
