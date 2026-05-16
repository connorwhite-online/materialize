import { Webhook } from "svix";
import { headers } from "next/headers";
import { WebhookEvent } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import { organizationMembers, organizations, users } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { logError } from "@/lib/logger";

// Strip Clerk's "org:" role prefix. Clerk ships roles as `org:admin`
// and `org:member`; our DB column stores the bare segment. Anything
// custom (`org:viewer`, …) falls through to its bare segment too —
// lib/authorization.ts treats anything other than "admin" as "member"
// for write-gating purposes.
function normalizeRole(role: string): string {
  return role.startsWith("org:") ? role.slice(4) : role;
}

export async function POST(req: Request) {
  const WEBHOOK_SECRET = process.env.CLERK_WEBHOOK_SECRET;
  if (!WEBHOOK_SECRET) {
    throw new Error("Missing CLERK_WEBHOOK_SECRET");
  }

  const headerPayload = await headers();
  const svixId = headerPayload.get("svix-id");
  const svixTimestamp = headerPayload.get("svix-timestamp");
  const svixSignature = headerPayload.get("svix-signature");

  if (!svixId || !svixTimestamp || !svixSignature) {
    return new Response("Missing svix headers", { status: 400 });
  }

  const payload = await req.json();
  const body = JSON.stringify(payload);

  const wh = new Webhook(WEBHOOK_SECRET);
  let event: WebhookEvent;

  try {
    event = wh.verify(body, {
      "svix-id": svixId,
      "svix-timestamp": svixTimestamp,
      "svix-signature": svixSignature,
    }) as WebhookEvent;
  } catch {
    return new Response("Invalid signature", { status: 400 });
  }

  try {
    if (event.type === "user.created" || event.type === "user.updated") {
      const { id, username, first_name, last_name, image_url, has_image } =
        event.data;
      const displayName = [first_name, last_name].filter(Boolean).join(" ");
      // Only store a real uploaded avatar — ignore Clerk's auto-generated placeholder
      const avatarUrl = has_image ? image_url : null;

      await db
        .insert(users)
        .values({
          id,
          username: username ?? null,
          displayName: displayName || null,
          avatarUrl,
        })
        .onConflictDoUpdate({
          target: users.id,
          set: {
            username: username ?? undefined,
            displayName: displayName || undefined,
            avatarUrl,
            updatedAt: new Date(),
          },
        });
    }

    if (event.type === "user.deleted") {
      const { id } = event.data;
      if (id) {
        await db.delete(users).where(eq(users.id, id));
      }
    }

    // Organization lifecycle — mirror into our local `organizations`
    // table so SQL joins (auth helper, profile pages, dashboards) can
    // resolve org names + slugs without a Clerk round-trip.
    if (
      event.type === "organization.created" ||
      event.type === "organization.updated"
    ) {
      const { id, name, slug, image_url, has_image } = event.data;
      const imageUrl = has_image ? image_url : null;
      await db
        .insert(organizations)
        .values({
          id,
          name,
          slug,
          imageUrl,
        })
        .onConflictDoUpdate({
          target: organizations.id,
          set: {
            name,
            slug,
            imageUrl,
            updatedAt: new Date(),
          },
        });
    }

    if (event.type === "organization.deleted") {
      const { id } = event.data;
      if (id) {
        // Cascades to organization_members and to any resources whose
        // organization_id FK is set with ON DELETE CASCADE
        // (files/projects/collections). print_orders' FK is ON DELETE
        // SET NULL — historical orders survive the org deletion.
        await db.delete(organizations).where(eq(organizations.id, id));
      }
    }

    // Membership lifecycle — `created` and `updated` upsert, `deleted`
    // removes. Clerk's membership id is stable for the lifetime of the
    // (user, org) pair, so it works as the primary key without needing
    // a (user_id, org_id) composite lookup on delete.
    if (
      event.type === "organizationMembership.created" ||
      event.type === "organizationMembership.updated"
    ) {
      const { id, role, organization, public_user_data } = event.data;
      const userId = public_user_data.user_id;
      // Defensive upsert on the organization row in case the
      // membership event lands before its parent org.created (we
      // don't control Clerk's webhook delivery order).
      await db
        .insert(organizations)
        .values({
          id: organization.id,
          name: organization.name,
          slug: organization.slug,
          imageUrl: organization.has_image ? organization.image_url : null,
        })
        .onConflictDoUpdate({
          target: organizations.id,
          set: {
            name: organization.name,
            slug: organization.slug,
            updatedAt: new Date(),
          },
        });
      await db
        .insert(organizationMembers)
        .values({
          id,
          organizationId: organization.id,
          userId,
          role: normalizeRole(role),
        })
        .onConflictDoUpdate({
          target: organizationMembers.id,
          set: {
            role: normalizeRole(role),
            updatedAt: new Date(),
          },
        });
    }

    if (event.type === "organizationMembership.deleted") {
      const { id, organization, public_user_data } = event.data;
      // Delete by Clerk membership id first (the stable PK); fall
      // back to the (org, user) pair in case Clerk replayed a delete
      // for a row that was reseeded under a new id.
      if (id) {
        await db
          .delete(organizationMembers)
          .where(eq(organizationMembers.id, id));
      }
      if (organization?.id && public_user_data?.user_id) {
        await db
          .delete(organizationMembers)
          .where(
            and(
              eq(organizationMembers.organizationId, organization.id),
              eq(organizationMembers.userId, public_user_data.user_id)
            )
          );
      }
    }
  } catch (err) {
    logError("clerkWebhook", { eventType: event.type, err });
    // Return 500 so Clerk retries. The handler is idempotent (all
    // writes are upserts or delete-if-exists), so retries are safe.
    return new Response("Handler error", { status: 500 });
  }

  return new Response("OK", { status: 200 });
}
