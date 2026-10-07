import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { LayersIcon } from "lucide-react";
import { db } from "@/lib/db";
import { files } from "@/lib/db/schema";
import { and, eq, desc } from "drizzle-orm";
import { notUnsavedStudioDraft } from "@/lib/studio-drafts";
import { Page, PageHeader } from "@/components/ui/page";
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
    <Page width="narrow">
      <PageHeader
        icon={<LayersIcon />}
        title="New project"
        description="Bundle files into a set people can print, download or buy together."
      />
      <ProjectCreateForm ownedFiles={ownedFiles} />
    </Page>
  );
}
