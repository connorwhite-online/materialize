import { Webhook } from "svix";
import { headers } from "next/headers";
import { WebhookEvent } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

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

  if (event.type === "user.created" || event.type === "user.updated") {
    const { id, username, first_name, last_name, image_url } = event.data;
    const displayName = [first_name, last_name].filter(Boolean).join(" ");

    await db
      .insert(users)
      .values({
        id,
        username: username ?? null,
        displayName: displayName || null,
        avatarUrl: image_url ?? null,
      })
      .onConflictDoUpdate({
        target: users.id,
        set: {
          username: username ?? undefined,
          displayName: displayName || undefined,
          avatarUrl: image_url ?? undefined,
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

  return new Response("OK", { status: 200 });
}
