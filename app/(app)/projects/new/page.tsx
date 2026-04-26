import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import { files } from "@/lib/db/schema";
import { eq, desc } from "drizzle-orm";
import { ProjectCreateForm } from "@/components/projects/project-create-form";

export default async function NewProjectPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const ownedFiles = await db
    .select({
      id: files.id,
      name: files.name,
      thumbnailUrl: files.thumbnailUrl,
    })
    .from(files)
    .where(eq(files.userId, userId))
    .orderBy(desc(files.createdAt));

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">New project</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Bundle multiple files into a single sellable unit.
        </p>
      </div>
      <ProjectCreateForm ownedFiles={ownedFiles} />
    </div>
  );
}
