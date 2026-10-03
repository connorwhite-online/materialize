import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { eq } from "drizzle-orm";
import { auth } from "@clerk/nextjs/server";
import { Page, PageHeader } from "@/components/ui/page";
import { listPersonalAccessTokens } from "@/app/actions/tokens";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { TokensManager } from "./tokens-manager";

export default async function TokensSettingsPage() {
  const { userId } = await auth();
  if (!userId) redirect("/");

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
    : (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000");

  return (
    <Page width="narrow">
      <PageHeader
        back={{ href: "/dashboard/settings", label: "Settings" }}
        title="Connected agents"
        description={
          <>
            Personal access tokens (PATs) let agents and tools talk to the
            Materialize MCP server on your behalf. Each token is scoped — agents
            can only do what you grant. ChatGPT and Claude can also connect with
            just the endpoint below: they ask you to sign in, and show up here
            once you do. You&apos;ll still review and pay for any print order
            before it&apos;s placed.
            <span className="mt-3 flex w-fit max-w-full items-center gap-2 rounded-full bg-muted/60 py-1 pr-3 pl-1 text-xs ring-1 ring-foreground/5">
              <span className="rounded-full bg-card px-2 py-0.5 font-medium text-foreground shadow-raised">
                MCP
              </span>
              <code className="truncate font-mono select-all">
                {baseUrl}/api/mcp
              </code>
            </span>
          </>
        }
      />

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
    </Page>
  );
}
