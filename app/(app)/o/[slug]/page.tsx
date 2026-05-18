import { permanentRedirect } from "next/navigation";

// Legacy `/o/[slug]` route — permanent (308) redirect to the
// unified `/[handle]` namespace. Same posture as `/u/[username]`:
// keeps bookmarks and inbound links live without dragging two
// parallel routing trees forward.

export default async function LegacyOrgProfileRedirect(props: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { slug } = await props.params;
  const searchParams = await props.searchParams;
  const queryString = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    if (typeof value === "string") queryString.set(key, value);
    else if (Array.isArray(value))
      for (const v of value) queryString.append(key, v);
  }
  const qs = queryString.toString();
  permanentRedirect(`/${slug}${qs ? `?${qs}` : ""}`);
}
