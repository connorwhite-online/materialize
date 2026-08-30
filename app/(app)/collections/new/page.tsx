import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { FolderOpenIcon } from "lucide-react";
import { CollectionCreateForm } from "@/components/collections/collection-create-form";
import { CreateFormHeader } from "@/components/create-form-header";

export default async function NewCollectionPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <CreateFormHeader
        icon={<FolderOpenIcon className="size-7" />}
        title="New collection"
        description="Group related files. You can add files to it from any of your uploads."
      />
      <CollectionCreateForm />
    </div>
  );
}
