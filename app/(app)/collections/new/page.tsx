import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { FolderOpenIcon } from "lucide-react";
import { CollectionCreateForm } from "@/components/collections/collection-create-form";
import { Page, PageHeader } from "@/components/ui/page";

export default async function NewCollectionPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  return (
    <Page width="narrow">
      <PageHeader
        icon={<FolderOpenIcon />}
        title="New collection"
        description="Group related files. Add files to it from any of your uploads."
      />
      <CollectionCreateForm />
    </Page>
  );
}
