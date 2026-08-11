import { redirect } from "next/navigation";
import { currentUser } from "@clerk/nextjs/server";

export default async function OrdersRedirect({
  searchParams,
}: {
  searchParams: Promise<{
    welcome?: string;
    payment?: string;
    production?: string;
  }>;
}) {
  const user = await currentUser();
  if (!user) redirect("/");
  // Forward any welcome / payment / production flags from the Stripe
  // and CraftCloud-bridge return URLs through to the real orders view
  // so the profile page can render its post-checkout states (anon-flow
  // welcome, two-step production-paid confirmation).
  const params = await searchParams;
  const query = new URLSearchParams({ tab: "orders" });
  if (params.welcome) query.set("welcome", params.welcome);
  if (params.payment) query.set("payment", params.payment);
  if (params.production) query.set("production", params.production);
  if (!user.username) {
    redirect(`/onboarding?${query.toString()}`);
  }
  redirect(`/${user.username}?${query.toString()}`);
}
