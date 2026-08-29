import { notFound } from "next/navigation";
import { isMockCheckoutMode } from "@/lib/craftcloud/client";
import { FeeSheetSandbox } from "./client";

/**
 * Sandbox stand-in for the saved-card service-fee sheet — the surface
 * that shows the 3D Materialize card (logo top-left, metal chip on the
 * right). Mock checkout mode only; notFound() against the live API so
 * this page never exists in production.
 *
 * Public at the proxy layer (see PUBLIC_ROUTES) so the page's own
 * mock-mode gate can notFound() rather than bounce anon visitors to
 * sign-in and disclose the route.
 */
export default function SandboxFeeSheetPage() {
  if (!isMockCheckoutMode()) notFound();
  return <FeeSheetSandbox />;
}
