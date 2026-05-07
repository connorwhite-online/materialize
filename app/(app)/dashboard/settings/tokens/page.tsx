import Link from "next/link";
import { headers } from "next/headers";
import { eq } from "drizzle-orm";
import { auth } from "@clerk/nextjs/server";
import { ChevronLeft } from "@/components/icons/chevron-left";
import { listPersonalAccessTokens } from "@/app/actions/tokens";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { TokensManager } from "./tokens-manager";

export default async function TokensSettingsPage() {
  const { userId } = await auth();
  if (!userId) return null;

  const [tokens, [billingRow]] = await Promise.all([
    listPersonalAccessTokens(),
    db
      .select({ defaultPaymentMethod: users.defaultPaymentMethod })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1),
  ]);
  const hasPaymentMethod = !!billingRow?.defaultPaymentMethod;

  // Derive the MCP endpoint URL from the live request rather than a
  // build-time env var. NEXT_PUBLIC_APP_URL was unreliable here —
  // unset in some environments, baked at build time when set — and
  // produced an obviously-wrong "http://localhost:3000" on prod.
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "https";
  const baseUrl = host
    ? `${proto}://${host}`
    : process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 space-y-6">
      <Link
        href="/dashboard/settings"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ChevronLeft size={16} />
        Settings
      </Link>

      <div>
        <h1 className="text-2xl font-bold">Connected agents</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Personal access tokens (PATs) let agents and tools talk to the
          Materialize MCP server on your behalf. Each token is scoped — agents
          can only do what you grant. You'll still review and pay for any print
          order before it's placed.
        </p>
        <p className="mt-2 text-xs text-muted-foreground">
          MCP endpoint:{" "}
          <code className="rounded bg-muted px-1 py-0.5">
            {baseUrl}/api/mcp
          </code>
        </p>
      </div>

      <TokensManager
        hasPaymentMethod={hasPaymentMethod}
        initialTokens={tokens.map((t) => ({
          ...t,
          createdAt: t.createdAt.toISOString(),
          lastUsedAt: t.lastUsedAt?.toISOString() ?? null,
          expiresAt: t.expiresAt?.toISOString() ?? null,
          revokedAt: t.revokedAt?.toISOString() ?? null,
        }))}
      />
    </div>
  );
}
