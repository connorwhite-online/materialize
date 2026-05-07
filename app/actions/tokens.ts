"use server";

import { auth } from "@clerk/nextjs/server";
import { and, desc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { personalAccessTokens } from "@/lib/db/schema";
import { logError } from "@/lib/logger";
import { generateToken } from "@/lib/mcp/tokens";
import { isValidScope, type Scope } from "@/lib/mcp/scopes";
import type { SpendingPolicy } from "@/lib/billing/policy";

const createTokenSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(80),
  scopes: z
    .array(z.string())
    .min(1, "Select at least one scope")
    .refine((s) => s.every(isValidScope), "Unknown scope"),
});

export async function createPersonalAccessToken(input: {
  name: string;
  scopes: Scope[];
}): Promise<
  | { ok: true; raw: string; prefix: string; id: string }
  | { ok: false; error: string }
> {
  const { userId } = await auth();
  if (!userId) return { ok: false, error: "Unauthorized" };

  const parsed = createTokenSchema.safeParse(input);
  if (!parsed.success) {
    const first =
      parsed.error.flatten().formErrors[0] ??
      Object.values(parsed.error.flatten().fieldErrors)[0]?.[0] ??
      "Invalid input";
    return { ok: false, error: first };
  }

  try {
    const generated = generateToken();
    const [row] = await db
      .insert(personalAccessTokens)
      .values({
        userId,
        name: parsed.data.name,
        tokenHash: generated.hash,
        prefix: generated.prefix,
        scopes: parsed.data.scopes,
      })
      .returning({ id: personalAccessTokens.id });

    revalidatePath("/dashboard/settings/tokens");
    return { ok: true, raw: generated.raw, prefix: generated.prefix, id: row.id };
  } catch (error) {
    logError("createPersonalAccessToken", error);
    return { ok: false, error: "Failed to create token" };
  }
}

export async function listPersonalAccessTokens() {
  const { userId } = await auth();
  if (!userId) return [];
  return db
    .select({
      id: personalAccessTokens.id,
      name: personalAccessTokens.name,
      prefix: personalAccessTokens.prefix,
      scopes: personalAccessTokens.scopes,
      spendingPolicy: personalAccessTokens.spendingPolicy,
      createdAt: personalAccessTokens.createdAt,
      lastUsedAt: personalAccessTokens.lastUsedAt,
      expiresAt: personalAccessTokens.expiresAt,
      revokedAt: personalAccessTokens.revokedAt,
    })
    .from(personalAccessTokens)
    .where(eq(personalAccessTokens.userId, userId))
    .orderBy(desc(personalAccessTokens.createdAt));
}

const spendingPolicySchema = z
  .object({
    perOrderLimitCents: z.number().int().min(50).max(1_000_000),
    periodBudgetCents: z.number().int().min(50).max(10_000_000),
    periodWindow: z.enum(["day", "week", "month"]),
    confirmAboveCents: z.number().int().min(50).max(1_000_000).optional(),
    allowedVendorIds: z.array(z.string()).max(50).optional(),
    allowedMaterialIds: z.array(z.string()).max(50).optional(),
    cancellationWindowMinutes: z
      .number()
      .int()
      .min(0)
      .max(60)
      .optional(),
  })
  .refine(
    (p) => p.periodBudgetCents >= p.perOrderLimitCents,
    "Period budget must be at least the per-order limit"
  )
  .refine(
    (p) =>
      p.confirmAboveCents == null || p.confirmAboveCents <= p.perOrderLimitCents,
    "Confirm-above threshold must be at or below the per-order limit"
  );

export async function updateTokenSpendingPolicy(input: {
  tokenId: string;
  policy: SpendingPolicy | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const { userId } = await auth();
  if (!userId) return { ok: false, error: "Unauthorized" };

  let policyToStore: SpendingPolicy | null = null;
  if (input.policy != null) {
    const parsed = spendingPolicySchema.safeParse(input.policy);
    if (!parsed.success) {
      const first =
        parsed.error.flatten().formErrors[0] ??
        Object.values(parsed.error.flatten().fieldErrors)[0]?.[0] ??
        "Invalid policy";
      return { ok: false, error: first };
    }
    policyToStore = parsed.data;
  }

  try {
    const result = await db
      .update(personalAccessTokens)
      .set({ spendingPolicy: policyToStore })
      .where(
        and(
          eq(personalAccessTokens.id, input.tokenId),
          eq(personalAccessTokens.userId, userId)
        )
      )
      .returning({ id: personalAccessTokens.id });

    if (result.length === 0) return { ok: false, error: "Token not found" };

    revalidatePath("/dashboard/settings/tokens");
    return { ok: true };
  } catch (error) {
    logError("updateTokenSpendingPolicy", error);
    return { ok: false, error: "Failed to save policy" };
  }
}

export async function revokePersonalAccessToken(
  id: string
): Promise<{ ok: boolean; error?: string }> {
  const { userId } = await auth();
  if (!userId) return { ok: false, error: "Unauthorized" };

  try {
    const result = await db
      .update(personalAccessTokens)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(personalAccessTokens.id, id),
          eq(personalAccessTokens.userId, userId)
        )
      )
      .returning({ id: personalAccessTokens.id });
    if (result.length === 0) return { ok: false, error: "Token not found" };

    revalidatePath("/dashboard/settings/tokens");
    return { ok: true };
  } catch (error) {
    logError("revokePersonalAccessToken", error);
    return { ok: false, error: "Failed to revoke token" };
  }
}
