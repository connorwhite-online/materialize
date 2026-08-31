import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { loadProjectBySlug } from "../../loader";
import { canWriteProject } from "@/lib/authorization";
import { BuildGuideEditor } from "@/components/projects/build-guide-editor";

export const metadata: Metadata = {
  title: "Edit guide",
  robots: { index: false, follow: false },
};

/**
 * Focused, full-page build-guide editor. Owner / org-member /
 * collaborator only — anyone else is bounced back to the project page.
 */
export default async function EditBuildGuidePage(props: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await props.params;
  const { userId } = await auth();
  if (!userId) redirect(`/projects/${slug}`);

  const project = await loadProjectBySlug(slug);
  if (!project) notFound();

  const access = await canWriteProject(userId, project.id);
  if (!access.ok) redirect(`/projects/${slug}`);

  return (
    <BuildGuideEditor
      projectId={project.id}
      slug={project.slug}
      projectName={project.name}
      buildGuide={project.buildGuide}
    />
  );
}
