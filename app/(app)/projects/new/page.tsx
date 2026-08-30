import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { LayersIcon } from "lucide-react";
import { db } from "@/lib/db";
import { files } from "@/lib/db/schema";
import { and, eq, desc } from "drizzle-orm";
import { notUnsavedStudioDraft } from "@/lib/studio-drafts";
import { CreateFormHeader } from "@/components/create-form-header";
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
    // Library picker: unsaved text-to-CAD drafts stay studio-only
    // (docs/text-to-cad/05 §B).
    .where(and(eq(files.userId, userId), notUnsavedStudioDraft()))
    .orderBy(desc(files.createdAt));

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <CreateFormHeader
        icon={<LayersIcon className="size-7" />}
        title="New project"
        description="Bundle multiple files into a single sellable unit."
      />
      <ProjectCreateForm ownedFiles={ownedFiles} />
    </div>
  );
}
