import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { resolveHandle } from "@/lib/handles/resolve";
import { loadUserByHandle, loadOrgByHandle } from "./loader";
import { UserProfileView } from "@/components/profile/user-profile-view";
import { OrgProfileView } from "@/components/orgs/org-profile-view";

// Unified `/[handle]` dispatch. Resolves the URL segment against the
// shared user-username / org-slug namespace and renders either the
// user profile or the org profile body. Reserved words and existing
// static routes win Next's routing precedence over this dynamic
// segment, so we don't have to filter them here.
//
// Old `/u/[username]` and `/o/[slug]` routes become permanent
// redirects (see their respective page.tsx files) so bookmarks and
// inbound links keep working — the redirect target is `/[handle]`.

function truncate(s: string, n: number) {
  return s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s;
}

export async function generateMetadata(props: {
  params: Promise<{ handle: string }>;
}): Promise<Metadata> {
  const { handle } = await props.params;
  const resolution = await resolveHandle(handle);
  if (!resolution) {
    return { title: "Not found", robots: { index: false, follow: false } };
  }

  if (resolution.kind === "user") {
    const user = await loadUserByHandle(handle);
    if (!user) {
      return { title: "Not found", robots: { index: false, follow: false } };
    }
    const name = user.displayName || user.username || handle;
    const at = user.username ? `@${user.username}` : handle;
    const description = truncate(
      user.bio?.trim() ||
        `${name} (${at}) on Materialize — 3D-print files and projects.`,
      155
    );
    const url = `/${handle}`;
    return {
      title: name,
      description,
      alternates: { canonical: url },
      openGraph: {
        type: "profile",
        title: name,
        description,
        url,
        username: user.username ?? undefined,
      },
      twitter: { card: "summary_large_image", title: name, description },
    };
  }

  // resolution.kind === "org"
  const org = await loadOrgByHandle(handle);
  if (!org) {
    return { title: "Not found", robots: { index: false, follow: false } };
  }
  const description = truncate(
    org.bio?.trim() ||
      `${org.name} on Materialize — 3D-print files and projects.`,
    155
  );
  const url = `/${handle}`;
  return {
    title: org.name,
    description,
    alternates: { canonical: url },
    openGraph: { type: "profile", title: org.name, description, url },
    twitter: { card: "summary_large_image", title: org.name, description },
  };
}

export default async function HandlePage(props: {
  params: Promise<{ handle: string }>;
  searchParams: Promise<{
    tab?: string;
    welcome?: string;
    payment?: string;
    production?: string;
  }>;
}) {
  const { handle } = await props.params;
  const searchParams = await props.searchParams;

  const resolution = await resolveHandle(handle);
  if (!resolution) notFound();

  if (resolution.kind === "user") {
    return <UserProfileView handle={handle} searchParams={searchParams} />;
  }
  return <OrgProfileView handle={handle} />;
}
