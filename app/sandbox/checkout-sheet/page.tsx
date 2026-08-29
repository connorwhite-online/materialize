import { notFound } from "next/navigation";
import { isMockCheckoutMode } from "@/lib/craftcloud/client";
import { CheckoutSheetSandbox } from "./client";

/**
 * Sandbox stand-in for the vendor checkout sheet (shipping → address).
 * Mock checkout mode only; notFound() against the live API so this
 * page never exists in production.
 *
 * Public at the proxy layer (see PUBLIC_ROUTES) so the page's own
 * mock-mode gate can notFound() rather than bounce anon visitors to
 * sign-in and disclose the route.
 */
export default function SandboxCheckoutSheetPage() {
  if (!isMockCheckoutMode()) notFound();
  return <CheckoutSheetSandbox />;
}
