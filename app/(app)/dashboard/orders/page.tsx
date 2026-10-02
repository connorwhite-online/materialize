import { redirect } from "next/navigation";
import { auth, currentUser } from "@clerk/nextjs/server";
import { PartyPopperIcon, SparklesIcon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Page, PageHeader } from "@/components/ui/page";
import { Print } from "@/components/icons/print";
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
    <Page>
      <PageHeader
        icon={<Print />}
        title="Orders"
        description="Prints on their way to you, and carts you haven't checked out yet."
      />
      {showWelcome && (
        <Alert>
          <SparklesIcon />
          <AlertTitle>Welcome to Materialize — your order is in.</AlertTitle>
          <AlertDescription>
            We created an account for you so you can track this print and any
            future orders. Your email is already set up for status updates.
          </AlertDescription>
        </Alert>
      )}
      {showProductionPaid && (
        <Alert variant="success">
          <PartyPopperIcon />
          {productionConfirmed ? (
            <>
              <AlertTitle>
                Payment received — your print is on its way to production.
              </AlertTitle>
              <AlertDescription>
                CraftCloud confirmed your payment, and your service fee has
                now been charged. Track it below.
              </AlertDescription>
            </>
          ) : (
            <>
              <AlertTitle>
                Thanks — we&apos;re confirming your payment with CraftCloud.
              </AlertTitle>
              <AlertDescription>
                This usually takes a few minutes. Your service fee is only
                charged once CraftCloud confirms, and the order below
                updates on its own.
              </AlertDescription>
            </>
          )}
        </Alert>
      )}
      <OrdersTab userId={userId} />
    </Page>
  );
}
