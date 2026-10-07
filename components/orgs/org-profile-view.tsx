import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import {
  collections,
  files,
  organizationMembers,
  projects,
} from "@/lib/db/schema";
import { and, count, desc, eq } from "drizzle-orm";
import { notUnsavedStudioDraft } from "@/lib/studio-drafts";
import { isOrgMember } from "@/lib/authorization";
import { loadOrgByHandle } from "@/app/(app)/[handle]/loader";
import { Button } from "@/components/ui/button";
import { EmptyState, Page } from "@/components/ui/page";
import { FileCard } from "@/components/files/file-card";

const LIBRARY_LIMIT = 60;

/**
 * Server-rendered organization profile body. Extracted from the old
 * `/o/[slug]` route so the unified `/[handle]` catch-all can delegate
 * to it after resolving the handle. Members see the full library
 * (drafts + private rows); visitors see only published + public.
 *
 * The "Settings" affordance lives under `/[handle]/settings` for
 * admins; the catch-all settings route wires that up.
 */
export async function OrgProfileView({ handle }: { handle: string }) {
  const { userId } = await auth();

  const org = await loadOrgByHandle(handle);
  if (!org) notFound();

  const membership = await isOrgMember(userId, org.id);
  const isMember = membership.member;
  const isAdmin = membership.role === "admin";

  // Unsaved text-to-CAD drafts stay out of the library view even for
  // members (docs/text-to-cad/05 §B).
  const fileConditions = [
    eq(files.organizationId, org.id),
    notUnsavedStudioDraft(),
  ];
  const projectConditions = [eq(projects.organizationId, org.id)];
  const collectionConditions = [eq(collections.organizationId, org.id)];
  if (!isMember) {
    fileConditions.push(eq(files.status, "published"));
    fileConditions.push(eq(files.visibility, "public"));
    projectConditions.push(eq(projects.status, "published"));
    projectConditions.push(eq(projects.visibility, "public"));
    collectionConditions.push(eq(collections.visibility, "public"));
  }

  const [memberCount, fileRows, projectRows, collectionRows] = await Promise.all([
    db
      .select({ count: count() })
      .from(organizationMembers)
      .where(eq(organizationMembers.organizationId, org.id))
      .then((r) => r[0]?.count ?? 0),
    db
      .select({
        id: files.id,
        name: files.name,
        slug: files.slug,
        thumbnailUrl: files.thumbnailUrl,
        price: files.price,
        visibility: files.visibility,
        status: files.status,
      })
      .from(files)
      .where(and(...fileConditions))
      .orderBy(desc(files.createdAt))
      .limit(LIBRARY_LIMIT),
    db
      .select({
        id: projects.id,
        name: projects.name,
        slug: projects.slug,
        thumbnailUrl: projects.thumbnailUrl,
        price: projects.price,
        visibility: projects.visibility,
        status: projects.status,
      })
      .from(projects)
      .where(and(...projectConditions))
      .orderBy(desc(projects.createdAt))
      .limit(LIBRARY_LIMIT),
    db
      .select({
        id: collections.id,
        name: collections.name,
        slug: collections.slug,
        visibility: collections.visibility,
      })
      .from(collections)
      .where(and(...collectionConditions))
      .orderBy(desc(collections.createdAt))
      .limit(LIBRARY_LIMIT),
  ]);

  const badgeFor = (r: { visibility: string | null; status?: string | null }) =>
    r.visibility !== "public" || (r.status != null && r.status !== "published")
      ? r.status === "draft"
        ? "Draft"
        : "Private"
      : null;

  const sections: { title: string; items: CardItem[] }[] = [
    {
      title: "Files",
      items: fileRows.map((r) => ({
        id: r.id,
        name: r.name,
        href: `/files/${r.slug}`,
        thumbnailUrl: r.thumbnailUrl,
        badge: badgeFor(r),
      })),
    },
    {
      title: "Projects",
      items: projectRows.map((r) => ({
        id: r.id,
        name: r.name,
        href: `/projects/${r.slug}`,
        thumbnailUrl: r.thumbnailUrl,
        badge: badgeFor(r),
      })),
    },
    {
      title: "Collections",
      items: collectionRows.map((r) => ({
        id: r.id,
        name: r.name,
        href: `/collections/${r.slug}`,
        thumbnailUrl: null,
        badge: r.visibility !== "public" ? "Private" : null,
      })),
    },
  ];
  const nonEmpty = sections.filter((sec) => sec.items.length > 0);

  return (
    <Page width="wide" className="gap-10">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:gap-5">
        {org.imageUrl ? (
          <Image
            src={org.imageUrl}
            alt=""
            width={64}
            height={64}
            className="size-16 shrink-0 rounded-2xl bg-muted object-cover"
            unoptimized
          />
        ) : (
          <div
            aria-hidden
            className="flex size-16 shrink-0 items-center justify-center rounded-2xl bg-muted text-2xl font-semibold"
          >
            {org.name.slice(0, 1).toUpperCase()}
          </div>
        )}
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h1 className="text-2xl leading-7 font-semibold text-balance">
                {org.name}
              </h1>
              <p className="mt-0.5 text-sm text-muted-foreground tabular-nums">
                @{org.slug} · {memberCount}{" "}
                {memberCount === 1 ? "member" : "members"}
              </p>
            </div>
            {isAdmin && (
              <Button
                variant="secondary"
                size="sm"
                render={<Link href={`/${org.slug}/settings`} />}
              >
                Settings
              </Button>
            )}
          </div>
          {org.bio && (
            <p className="max-w-prose text-sm leading-6 text-pretty">{org.bio}</p>
          )}
          {!isMember && nonEmpty.length > 0 && (
            <p className="text-[13px] leading-[18px] text-subtle-foreground">
              Public profile. Members also see this team&apos;s private work.
            </p>
          )}
        </div>
      </header>

      {nonEmpty.length === 0 ? (
        <EmptyState
          title="Nothing published yet"
          description={
            isMember
              ? "Files, projects and collections you create under this team show up here."
              : "This team hasn't shared any files, projects or collections."
          }
        />
      ) : (
        nonEmpty.map((sec) => (
          <Section key={sec.title} title={sec.title} items={sec.items} />
        ))
      )}
    </Page>
  );
}

type CardItem = {
  id: string;
  name: string;
  href: string;
  thumbnailUrl: string | null;
  badge: string | null;
};

/** One shelf, on the same tile and grid as /files so the two can't drift. */
function Section({ title, items }: { title: string; items: CardItem[] }) {
  return (
    <section className="flex flex-col gap-4">
      <h2 className="flex items-baseline gap-2 text-base leading-6 font-semibold">
        {title}
        <span className="text-sm font-normal text-subtle-foreground tabular-nums">
          {items.length}
        </span>
      </h2>
      <div className="grid grid-cols-2 gap-x-3 gap-y-6 sm:grid-cols-3 sm:gap-x-4 lg:grid-cols-4 xl:grid-cols-5">
        {items.map((item) => (
          <FileCard
            key={item.id}
            href={item.href}
            title={item.name}
            thumbnailUrl={item.thumbnailUrl}
            placeholder={title === "Collections" ? "Collection" : "No preview"}
            overlay={
              item.badge ? (
                <span className="absolute top-2 left-2 rounded-full bg-background px-2 py-0.5 text-xs leading-5 font-medium shadow-sm">
                  {item.badge}
                </span>
              ) : null
            }
          />
        ))}
      </div>
    </section>
  );
}
