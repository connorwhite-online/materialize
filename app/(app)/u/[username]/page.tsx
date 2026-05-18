import { permanentRedirect } from "next/navigation";

// Legacy `/u/[username]` route — kept as a permanent (308) redirect
// so existing bookmarks, search engines, and inbound links keep
// working after the move to the unified `/[handle]` namespace.
// Query strings (`?tab=…`) survive — Next preserves them across
// permanentRedirect by appending them to the target.

export default async function LegacyUserProfileRedirect(props: {
  params: Promise<{ username: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { username } = await props.params;
  const searchParams = await props.searchParams;
  const queryString = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    if (typeof value === "string") queryString.set(key, value);
    else if (Array.isArray(value))
      for (const v of value) queryString.append(key, v);
  }
  const qs = queryString.toString();
  permanentRedirect(`/${username}${qs ? `?${qs}` : ""}`);
}
