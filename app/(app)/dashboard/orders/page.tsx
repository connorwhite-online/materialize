import { redirect } from "next/navigation";
import { auth, currentUser } from "@clerk/nextjs/server";
import { PartyPopperIcon } from "lucide-react";
import { OrdersTab } from "@/components/profile/orders-tab";
import { reconcileOrderForUser } from "@/lib/stripe/reconcile-production-payments";
import { logError } from "@/lib/logger";

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<{
    welcome?: string;
    payment?: string;
    production?: string;
    orderId?: string;
  }>;
}) {
  const { userId } = await auth();
  if (!userId) redirect("/");
  const user = await currentUser();
  if (!user?.username) redirect("/onboarding");

  const params = await searchParams;
  const showWelcome = params.welcome === "1" && params.payment === "success";
  const showProductionPaid = params.production === "paid";

  // Back from CraftCloud's payment page: check this order now instead of
  // leaving it "Awaiting production payment" until the hourly sweep.
  // CraftCloud can take a moment to record the payment, so "pending"
  // here is normal and the sweep still picks it up.
  let productionConfirmed = false;
  if (showProductionPaid && params.orderId) {
    try {
      const result = await reconcileOrderForUser(params.orderId, userId);
      productionConfirmed = result.captured > 0;
    } catch (error) {
      logError("ordersPage.reconcileOnReturn", error);
    }
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <h1 className="mb-6 text-2xl font-bold">Orders</h1>
      {showWelcome && (
        <div className="mb-6 rounded-xl border border-primary/30 bg-primary/5 p-4">
          <p className="text-sm font-medium">
            Welcome to Materialize — your order is in.
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            We created an account for you so you can track this print and any
            future orders. Your email is already set up for status updates.
          </p>
        </div>
      )}
      {showProductionPaid && (
        <div className="mb-6 flex items-center gap-3 rounded-xl border border-green-500/30 bg-green-500/5 p-4">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-green-100 text-green-600 dark:bg-green-950 dark:text-green-400">
            <PartyPopperIcon className="h-6 w-6" strokeWidth={2.5} />
          </div>
          <div>
            {productionConfirmed ? (
              <>
                <p className="text-sm font-medium">
                  Payment received — your print is on its way to production.
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  CraftCloud confirmed your payment, and your service fee has
                  now been charged. Track it below.
                </p>
              </>
            ) : (
              <>
                <p className="text-sm font-medium">
                  Thanks — we&apos;re confirming your payment with CraftCloud.
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  This usually takes a few minutes. Your service fee is only
                  charged once CraftCloud confirms, and the order below
                  updates on its own.
                </p>
              </>
            )}
          </div>
        </div>
      )}
      <OrdersTab userId={userId} />
    </div>
  );
}
