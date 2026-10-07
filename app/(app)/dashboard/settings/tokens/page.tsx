import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { eq } from "drizzle-orm";
import { auth, currentUser } from "@clerk/nextjs/server";
import { Page, PageHeader } from "@/components/ui/page";
import { listPersonalAccessTokens } from "@/app/actions/tokens";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { TokensManager } from "./tokens-manager";
import { McpEndpoint } from "./mcp-endpoint";
import { ownerSettingsHref } from "@/lib/profile/owner-settings-tabs";

export default async function TokensSettingsPage() {
  const { userId } = await auth();
  if (!userId) redirect("/");

  const [tokens, [billingRow], user] = await Promise.all([
    listPersonalAccessTokens(),
    db
      .select({ defaultPaymentMethod: users.defaultPaymentMethod })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1),
    currentUser(),
  ]);
  const backHref = user?.username
    ? ownerSettingsHref(user.username, "agents")
    : "/dashboard/settings";
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
    <Page width="narrow" className="gap-10">
      <PageHeader
        back={{ href: backHref, label: "Agents" }}
        title="Connected agents"
        description="Let ChatGPT, Claude or your own tools browse, quote and draft orders for you. Every order still waits for your OK unless you turn on auto-approve."
      />

      <section className="flex flex-col gap-3">
        <div>
          <h2 className="text-base leading-6 font-semibold">Server URL</h2>
          <p className="mt-0.5 text-sm text-pretty text-muted-foreground">
            Add this to ChatGPT or Claude. They&apos;ll ask you to sign in,
            then show up below.
          </p>
        </div>
        <McpEndpoint url={`${baseUrl}/api/mcp`} />
      </section>

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
