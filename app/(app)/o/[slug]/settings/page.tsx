import { permanentRedirect } from "next/navigation";

// Legacy `/o/[slug]/settings` — permanent redirect under the unified
// namespace.

export default async function LegacyOrgSettingsRedirect(props: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await props.params;
  permanentRedirect(`/${slug}/settings`);
}
