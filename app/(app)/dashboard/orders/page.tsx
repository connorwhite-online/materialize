import { redirect } from "next/navigation";
import { currentUser } from "@clerk/nextjs/server";

export default async function OrdersRedirect({
  searchParams,
}: {
  searchParams: Promise<{ welcome?: string; payment?: string }>;
}) {
  const user = await currentUser();
  if (!user) redirect("/");
  // Forward any welcome / payment flags from the Stripe success URL
  // through to the real orders view so the profile page can render
  // a post-checkout welcome state for anon-flow signups.
  const params = await searchParams;
  const query = new URLSearchParams({ tab: "orders" });
  if (params.welcome) query.set("welcome", params.welcome);
  if (params.payment) query.set("payment", params.payment);
  if (!user.username) {
    redirect(`/onboarding?${query.toString()}`);
  }
  redirect(`/u/${user.username}?${query.toString()}`);
}
