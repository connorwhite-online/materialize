import { loadStripe, type Stripe } from "@stripe/stripe-js";

/**
 * Client-side Stripe.js singleton for the embedded Payment Element.
 * Separate from lib/stripe.ts (server SDK, "server-only") — this file
 * must be importable from client components.
 *
 * NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY is inlined at build time. The
 * server only offers the embedded fee sheet when the same var is set
 * (prepareEmbeddedFeeSheet), so a missing key degrades to hosted
 * Checkout instead of a broken sheet.
 */
let stripePromise: Promise<Stripe | null> | null = null;

export function getStripeBrowser(): Promise<Stripe | null> {
  if (!stripePromise) {
    const key = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
    stripePromise = key ? loadStripe(key) : Promise.resolve(null);
  }
  return stripePromise;
}
