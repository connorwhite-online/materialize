import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import {
  collections,
  files,
  organizationMembers,
  organizations,
  projects,
} from "@/lib/db/schema";
import { and, count, desc, eq } from "drizzle-orm";
import { isOrgMember } from "@/lib/authorization";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";

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

  const [org] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.slug, handle));
  if (!org) notFound();

  const membership = await isOrgMember(userId, org.id);
  const isMember = membership.member;
  const isAdmin = membership.role === "admin";

  const fileConditions = [eq(files.organizationId, org.id)];
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

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <div className="flex items-start gap-6">
        {org.imageUrl ? (
          <Image
            src={org.imageUrl}
            alt={org.name}
            width={80}
            height={80}
            className="h-20 w-20 rounded-2xl border bg-muted object-cover"
            unoptimized
          />
        ) : (
          <div className="flex h-20 w-20 items-center justify-center rounded-2xl border bg-muted text-2xl font-bold">
            {org.name.slice(0, 1).toUpperCase()}
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold">{org.name}</h1>
              <p className="text-muted-foreground">@{org.slug}</p>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="secondary">
                {memberCount} {memberCount === 1 ? "member" : "members"}
              </Badge>
              {isAdmin && (
                <Button
                  variant="outline"
                  size="sm"
                  render={<Link href={`/${org.slug}/settings`} />}
                >
                  Settings
                </Button>
              )}
            </div>
          </div>
          {org.bio && (
            <p className="mt-2 max-w-xl text-sm leading-relaxed">{org.bio}</p>
          )}
          {!isMember && (
            <p className="mt-2 text-xs text-muted-foreground">
              You&apos;re viewing the public profile. Members see this
              org&apos;s private files, projects, and collections too.
            </p>
          )}
        </div>
      </div>

      <Separator className="my-6" />

      <Section
        title="Files"
        empty="No files yet."
        items={fileRows.map((r) => ({
          id: r.id,
          name: r.name,
          href: `/files/${r.slug}`,
          thumbnailUrl: r.thumbnailUrl,
          badge:
            r.visibility !== "public" || r.status !== "published"
              ? r.status === "draft"
                ? "Draft"
                : "Private"
              : null,
        }))}
      />
      <Section
        title="Projects"
        empty="No projects yet."
        items={projectRows.map((r) => ({
          id: r.id,
          name: r.name,
          href: `/projects/${r.slug}`,
          thumbnailUrl: r.thumbnailUrl,
          badge:
            r.visibility !== "public" || r.status !== "published"
              ? r.status === "draft"
                ? "Draft"
                : "Private"
              : null,
        }))}
      />
      <Section
        title="Collections"
        empty="No collections yet."
        items={collectionRows.map((r) => ({
          id: r.id,
          name: r.name,
          href: `/collections/${r.slug}`,
          thumbnailUrl: null,
          badge: r.visibility !== "public" ? "Private" : null,
        }))}
      />
    </div>
  );
}

type CardItem = {
  id: string;
  name: string;
  href: string;
  thumbnailUrl: string | null;
  badge: string | null;
};

function Section({
  title,
  items,
  empty,
}: {
  title: string;
  items: CardItem[];
  empty: string;
}) {
  if (items.length === 0) {
    return (
      <div className="mt-8">
        <h2 className="text-lg font-semibold">{title}</h2>
        <p className="mt-2 text-sm text-muted-foreground">{empty}</p>
      </div>
    );
  }
  return (
    <div className="mt-8">
      <h2 className="text-lg font-semibold">{title}</h2>
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {items.map((item) => (
          <Link key={item.id} href={item.href} className="group">
            <Card className="overflow-hidden">
              <div className="relative aspect-square bg-muted">
                {item.thumbnailUrl ? (
                  <Image
                    src={item.thumbnailUrl}
                    alt={item.name}
                    fill
                    className="object-cover transition-opacity group-hover:opacity-90"
                    sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
                    unoptimized
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-3xl text-muted-foreground">
                    {item.name.slice(0, 1).toUpperCase()}
                  </div>
                )}
                {item.badge && (
                  <span className="absolute right-2 top-2 rounded-full bg-background/90 px-2 py-0.5 text-xs font-medium shadow-sm">
                    {item.badge}
                  </span>
                )}
              </div>
              <CardContent className="p-3">
                <div className="truncate text-sm font-medium">{item.name}</div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
