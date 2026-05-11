"use server";

/**
 * Stripe Checkout session for purchasing a paid file or project.
 *
 * The Connect Express account on the creator side receives funds
 * via `payment_intent_data.transfer_data.destination`. Materialize
 * keeps a 3% `application_fee_amount` for the platform. The
 * `purchases` row is NOT inserted here — that happens in the
 * webhook on `checkout.session.completed` so a buyer abandoning
 * mid-flow doesn't strand a pending row.
 */

import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { files, projects, users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getStripe } from "@/lib/stripe";
import { logError } from "@/lib/logger";
import { userOwnsFile, userOwnsProject } from "@/lib/entitlement";

const APP_URL =
  process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

const SERVICE_FEE_RATE = 0.03;

type CheckoutResult = { url: string } | { error: string };

function calcServiceFee(amountCents: number) {
  return Math.round(amountCents * SERVICE_FEE_RATE);
}

interface ListingFetch {
  id: string;
  name: string;
  slug: string;
  price: number;
  ownerId: string;
  stripeAccountId: string | null;
  stripeOnboardingComplete: boolean;
  imageUrl: string | null;
}

async function loadFileForCheckout(
  fileId: string
): Promise<ListingFetch | null> {
  const [row] = await db
    .select({
      id: files.id,
      name: files.name,
      slug: files.slug,
      price: files.price,
      ownerId: files.userId,
      status: files.status,
      visibility: files.visibility,
      thumbnailUrl: files.thumbnailUrl,
      stripeAccountId: users.stripeAccountId,
      stripeOnboardingComplete: users.stripeOnboardingComplete,
    })
    .from(files)
    .innerJoin(users, eq(files.userId, users.id))
    .where(eq(files.id, fileId));
  if (!row) return null;
  // Crawlers / drafts shouldn't be purchasable.
  if (row.status !== "published" || row.visibility !== "public") return null;
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    price: row.price,
    ownerId: row.ownerId,
    stripeAccountId: row.stripeAccountId,
    stripeOnboardingComplete: row.stripeOnboardingComplete,
    imageUrl: row.thumbnailUrl,
  };
}

async function loadProjectForCheckout(
  projectId: string
): Promise<ListingFetch | null> {
  const [row] = await db
    .select({
      id: projects.id,
      name: projects.name,
      slug: projects.slug,
      price: projects.price,
      ownerId: projects.userId,
      status: projects.status,
      visibility: projects.visibility,
      thumbnailUrl: projects.thumbnailUrl,
      stripeAccountId: users.stripeAccountId,
      stripeOnboardingComplete: users.stripeOnboardingComplete,
    })
    .from(projects)
    .innerJoin(users, eq(projects.userId, users.id))
    .where(eq(projects.id, projectId));
  if (!row) return null;
  if (row.status !== "published" || row.visibility !== "public") return null;
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    price: row.price,
    ownerId: row.ownerId,
    stripeAccountId: row.stripeAccountId,
    stripeOnboardingComplete: row.stripeOnboardingComplete,
    imageUrl: row.thumbnailUrl,
  };
}

/**
 * Public entry point — accepts either { fileId } or { projectId } and
 * returns a Stripe-hosted Checkout URL ready to redirect to. The
 * gates here intentionally fail loudly with a user-readable error
 * because the Purchase button on the listing page surfaces these
 * directly.
 */
export async function createListingCheckoutSession(params: {
  fileId?: string;
  projectId?: string;
}): Promise<CheckoutResult> {
  try {
    const { userId } = await auth();
    if (!userId) return { error: "Sign in to purchase" };

    if (!params.fileId && !params.projectId) {
      return { error: "No listing specified" };
    }
    if (params.fileId && params.projectId) {
      return { error: "Specify one listing, not both" };
    }

    const listing = params.fileId
      ? await loadFileForCheckout(params.fileId)
      : await loadProjectForCheckout(params.projectId!);
    if (!listing) return { error: "Listing not found" };

    if (listing.ownerId === userId) {
      return { error: "You can't buy your own listing" };
    }
    if (listing.price <= 0) {
      return { error: "This listing is free" };
    }
    if (!listing.stripeAccountId || !listing.stripeOnboardingComplete) {
      return {
        error: "This creator hasn't enabled payouts yet — try again later.",
      };
    }

    // Already-owned check — block re-purchase. Mirrors the
    // entitlement helpers used elsewhere (free listings short-circuit
    // to true; we already rejected price=0 above so this only catches
    // actual prior purchases).
    const alreadyOwns = params.fileId
      ? await userOwnsFile(userId, listing.id)
      : await userOwnsProject(userId, listing.id);
    if (alreadyOwns) {
      return { error: "You already own this listing" };
    }

    const serviceFee = calcServiceFee(listing.price);
    const stripe = getStripe();

    const successPath =
      params.fileId
        ? `/files/${listing.slug}?purchase=success`
        : `/projects/${listing.slug}?purchase=success`;
    const cancelPath =
      params.fileId
        ? `/files/${listing.slug}?purchase=cancelled`
        : `/projects/${listing.slug}?purchase=cancelled`;

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      // automatic_payment_methods would let Stripe display every method
      // their dashboard config allows; for v1 we narrow to card to
      // keep payout timing predictable.
      payment_method_types: ["card"],
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "usd",
            unit_amount: listing.price,
            product_data: {
              name: listing.name,
              ...(listing.imageUrl ? { images: [listing.imageUrl] } : {}),
            },
          },
        },
      ],
      payment_intent_data: {
        application_fee_amount: serviceFee,
        transfer_data: { destination: listing.stripeAccountId },
        // Statement descriptor — limited to 22 chars on Stripe.
        // Keep short and identifiable.
        statement_descriptor: "MATERIALIZE",
      },
      metadata: {
        type: "listing_purchase",
        buyerId: userId,
        listingType: params.fileId ? "file" : "project",
        listingId: listing.id,
        amount: String(listing.price),
        serviceFee: String(serviceFee),
      },
      success_url: `${APP_URL}${successPath}`,
      cancel_url: `${APP_URL}${cancelPath}`,
    });

    if (!session.url) {
      return { error: "Stripe didn't return a checkout URL" };
    }
    return { url: session.url };
  } catch (error) {
    logError("createListingCheckoutSession", error);
    return { error: "Couldn't start checkout" };
  }
}

/**
 * Server-action variant invoked from a `<form action={...}>` — runs
 * the same logic and redirects on success. The plain function above
 * is the one the Purchase buttons use (they want to surface error
 * text in the UI), this is here for any future form-bound caller.
 */
export async function purchaseListingAction(formData: FormData) {
  const fileId = formData.get("fileId");
  const projectId = formData.get("projectId");
  const res = await createListingCheckoutSession({
    fileId: typeof fileId === "string" && fileId ? fileId : undefined,
    projectId:
      typeof projectId === "string" && projectId ? projectId : undefined,
  });
  if ("url" in res) {
    redirect(res.url);
  }
  // If we returned an error, leave the redirect off — the caller's
  // try/catch in a Client Component handles surfacing.
  throw new Error(res.error);
}

