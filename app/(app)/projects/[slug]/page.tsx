import { notFound } from "next/navigation";
import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import {
  projects,
  projectFiles,
  files,
  users,
  purchases,
} from "@/lib/db/schema";
import { eq, and, asc } from "drizzle-orm";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { DeleteProjectButton } from "@/components/projects/delete-project-button";
import { userOwnsProject } from "@/lib/entitlement";

const DESIGN_TAG_LABELS: Record<string, string> = {
  strong: "Strong",
  flexible: "Flexible",
  "heat-resistant": "Heat Resistant",
  watertight: "Watertight",
  detailed: "Detailed",
  lightweight: "Lightweight",
};

export default async function ProjectDetailPage(props: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await props.params;
  const { userId } = await auth();

  const [project] = await db
    .select({
      id: projects.id,
      name: projects.name,
      description: projects.description,
      slug: projects.slug,
      price: projects.price,
      license: projects.license,
      status: projects.status,
      visibility: projects.visibility,
      tags: projects.tags,
      designTags: projects.designTags,
      thumbnailUrl: projects.thumbnailUrl,
      downloadCount: projects.downloadCount,
      createdAt: projects.createdAt,
      userId: projects.userId,
      username: users.username,
      displayName: users.displayName,
      avatarUrl: users.avatarUrl,
    })
    .from(projects)
    .innerJoin(users, eq(projects.userId, users.id))
    .where(eq(projects.slug, slug));

  if (!project) notFound();
  const isOwner = userId === project.userId;
  if (project.status !== "published" && !isOwner) notFound();

  const bundledFiles = await db
    .select({
      id: files.id,
      name: files.name,
      slug: files.slug,
      thumbnailUrl: files.thumbnailUrl,
      price: files.price,
      position: projectFiles.position,
    })
    .from(projectFiles)
    .innerJoin(files, eq(projectFiles.fileId, files.id))
    .where(eq(projectFiles.projectId, project.id))
    .orderBy(asc(projectFiles.position));

  const canDownload = await userOwnsProject(userId, project.id);

  let ownerBuyerCount = 0;
  if (isOwner) {
    const buyerRows = await db
      .select({ id: purchases.id })
      .from(purchases)
      .where(
        and(
          eq(purchases.projectId, project.id),
          eq(purchases.status, "completed")
        )
      );
    ownerBuyerCount = buyerRows.length;
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <div className="grid gap-8 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-6">
          <div>
            <h1 className="text-2xl font-bold">{project.name}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Project
              <span className="mx-1.5">·</span>
              {bundledFiles.length}{" "}
              {bundledFiles.length === 1 ? "file" : "files"}
            </p>
          </div>

          {project.thumbnailUrl ? (
            <div className="aspect-[4/3] w-full overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-muted/40 to-muted/10">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={project.thumbnailUrl}
                alt=""
                className="w-full h-full object-cover"
              />
            </div>
          ) : (
            <div className="aspect-[4/3] rounded-2xl bg-gradient-to-br from-muted to-muted/50 flex items-center justify-center">
              <span className="text-xs text-muted-foreground/50">
                No cover image
              </span>
            </div>
          )}

          {project.description && (
            <p className="text-muted-foreground leading-relaxed">
              {project.description}
            </p>
          )}

          {project.tags && project.tags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {project.tags.map((tag) => (
                <Badge key={tag} variant="secondary" className="text-xs">
                  {tag}
                </Badge>
              ))}
            </div>
          )}

          {project.designTags && project.designTags.length > 0 && (
            <Card>
              <CardContent className="p-4">
                <p className="text-xs font-medium text-muted-foreground mb-2">
                  Print Recommendations
                </p>
                <div className="flex flex-wrap gap-1">
                  {project.designTags.map((tag) => (
                    <Badge
                      key={tag}
                      variant="outline"
                      className="text-[10px]"
                    >
                      {DESIGN_TAG_LABELS[tag] || tag}
                    </Badge>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          <div>
            <h2 className="text-sm font-medium mb-3">
              Files in this project
            </h2>
            <div className="grid gap-3 grid-cols-2 sm:grid-cols-3">
              {bundledFiles.map((file) => (
                <Link
                  key={file.id}
                  href={`/files/${file.slug}`}
                  className="group flex flex-col gap-2"
                >
                  <div className="aspect-square overflow-hidden rounded-lg border border-border bg-muted">
                    {file.thumbnailUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={file.thumbnailUrl}
                        alt=""
                        className="w-full h-full object-cover transition-transform group-hover:scale-105"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-xs text-muted-foreground/50">
                        No preview
                      </div>
                    )}
                  </div>
                  <p className="text-sm font-medium line-clamp-1">
                    {file.name}
                  </p>
                </Link>
              ))}
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                {project.avatarUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={project.avatarUrl}
                    alt=""
                    className="h-10 w-10 rounded-full"
                  />
                )}
                <div>
                  <Link
                    href={`/u/${project.username}`}
                    className="font-medium text-sm hover:underline"
                  >
                    {project.displayName || project.username}
                  </Link>
                </div>
              </div>

              <Separator className="my-4" />

              {project.price > 0 ? (
                <>
                  <p className="text-2xl font-bold">
                    ${(project.price / 100).toFixed(2)}
                  </p>
                  {canDownload ? (
                    <p className="text-xs text-muted-foreground mt-3">
                      Download files individually below.
                    </p>
                  ) : (
                    <Button className="w-full mt-3">Purchase</Button>
                  )}
                </>
              ) : (
                <>
                  <p className="text-lg font-medium text-muted-foreground">
                    Free
                  </p>
                  <p className="text-xs text-muted-foreground mt-3">
                    Download files individually below.
                  </p>
                </>
              )}

              <Separator className="my-4" />

              <div className="text-sm text-muted-foreground space-y-1">
                <p className="capitalize">License: {project.license}</p>
                <p>{bundledFiles.length} files in bundle</p>
              </div>

              {isOwner && (
                <>
                  <Separator className="my-4" />
                  <div className="space-y-2">
                    <DeleteProjectButton
                      projectId={project.id}
                      projectName={project.name}
                      hasBuyers={ownerBuyerCount > 0}
                      buyerCount={ownerBuyerCount}
                      redirectTo={`/u/${project.username}`}
                    />
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
