import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { CreateOrganization } from "@clerk/nextjs";
import { Page, PageHeader } from "@/components/ui/page";

// Standalone "create your first organization" page. Lives at /o/new
// because that's the natural URL when someone wants to spin up a new
// team but isn't yet a member of any. The org switcher in the nav
// only renders once you HAVE an org (otherwise it falls back to a
// stylistically off "Personal account" pill that doesn't match the
// rest of the chrome), so this page is the canonical entry point.
//
// We don't hand-build the form — Clerk's <CreateOrganization /> ships
// the input, slug autogen, image upload, and validation. We just gate
// it behind auth and route the user to their new org's profile on
// success.
//
// afterCreateOrganizationUrl MUST be a string: this is a server
// component and <CreateOrganization /> is a client one, so a function
// prop can't cross the boundary — it used to be `(org) => \`/${org.slug}\``,
// which threw "Functions cannot be passed directly to Client Components"
// and rendered the route's error screen for everyone. Clerk expands the
// `:slug` placeholder itself.
//
// `appearance` strips Clerk's own card chrome (shadow, border, footer
// badge spacing) so the form sits on the page like every other form
// instead of as a floating card inside it.

export default async function NewOrganizationPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in?redirect_url=/o/new");

  return (
    <Page width="narrow">
      <PageHeader
        title="New organization"
        description="Share files, projects and collections privately with your team."
      />
      <CreateOrganization
        routing="hash"
        afterCreateOrganizationUrl="/:slug"
        appearance={{
          // Clerk styles its elements with emotion, which outranks a
          // plain utility class, so every override here is `!important`.
          elements: {
            rootBox: "w-full max-w-md!",
            cardBox:
              "w-full! max-w-md! shadow-none! border-0! rounded-none! bg-transparent!",
            card: "w-full! max-w-none! shadow-none! border-0! bg-transparent! p-0! gap-6!",
            main: "w-full!",
            form: "w-full!",
            header: "hidden!",
            footer: "hidden!",
            formButtonPrimary:
              "h-9! rounded-full! px-4! text-sm! font-medium! shadow-none! bg-primary! text-primary-foreground! hover:bg-primary/85!",
            formFieldInput:
              "h-9! rounded-[10px]! border! border-input! bg-background! px-3! shadow-none! focus:border-ring! focus:shadow-input-focus!",
          },
          variables: {
            borderRadius: "10px",
            fontSize: "14px",
          },
        }}
      />
    </Page>
  );
}
