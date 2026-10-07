import Link from "next/link";
import { and, count, eq, isNull } from "drizzle-orm";
import { BotIcon, CreditCardIcon, LandmarkIcon } from "lucide-react";
import { db } from "@/lib/db";
import { personalAccessTokens, users } from "@/lib/db/schema";
import { swallow } from "@/lib/utils/swallow";
import { SettingsGroup, SettingsRow } from "@/components/ui/field";
import { ChevronRight } from "@/components/icons/chevron-right";
import { AppearanceControl } from "@/components/profile/appearance-control";
import { SocialLinksEditor } from "@/components/profile/owner-profile-headline";
import { UploadVisibilitySetting } from "@/app/(app)/dashboard/settings/upload-visibility-setting";
import { SignOutButton } from "@/app/(app)/dashboard/settings/sign-out-button";

/**
 * Owner Settings tab, laid out like ChatGPT's settings panel: titled
 * groups of rows, label + explanation on the left, the control on the
 * right, hairlines between. Every control saves on its own — there is
 * no Save button anywhere on this tab.
 */
export function GeneralSettings({
  defaultUploadVisibility,
  socialLinks,
}: {
  defaultUploadVisibility: "public" | "private";
  socialLinks: Array<{ platform: string; url: string }>;
}) {
  return (
    <div className="flex flex-col gap-10">
      <SocialLinksEditor initial={socialLinks} />

      <SettingsGroup title="Preferences">
        <SettingsRow
          title="Appearance"
          description="System follows your device."
          control={<AppearanceControl />}
        />
        <UploadVisibilitySetting initial={defaultUploadVisibility} />
      </SettingsGroup>

      <SettingsGroup title="Account">
        <SettingsRow
          title="Sign out"
          description="Sign out of Materialize on this device."
          control={<SignOutButton />}
        />
      </SettingsGroup>
    </div>
  );
}

export async function AgentSettings({ userId }: { userId: string }) {
  const [row] = await swallow(
    db
      .select({ value: count() })
      .from(personalAccessTokens)
      .where(
        and(
          eq(personalAccessTokens.userId, userId),
          isNull(personalAccessTokens.revokedAt)
        )
      )
  );
  const active = Number(row?.value ?? 0);

  return (
    <SettingsGroup
      title="Agents"
      description="Let ChatGPT, Claude and your own tools browse, quote and order on your behalf."
    >
      <SettingsLinkRow
        href="/dashboard/settings/tokens"
        icon={<BotIcon />}
        title="Connected agents"
        description="Tokens and spending limits"
        value={active > 0 ? `${active} active` : "None"}
      />
    </SettingsGroup>
  );
}

export async function PaymentSettings({ userId }: { userId: string }) {
  const [row] = await swallow(
    db
      .select({
        defaultPaymentMethod: users.defaultPaymentMethod,
        stripeAccountId: users.stripeAccountId,
        stripeOnboardingComplete: users.stripeOnboardingComplete,
      })
      .from(users)
      .where(eq(users.id, userId))
  );

  const payoutValue = row?.stripeOnboardingComplete
    ? "Connected"
    : row?.stripeAccountId
      ? "Incomplete"
      : "Not set up";

  return (
    <div className="flex flex-col gap-10">
      <SettingsGroup
        title="Paying"
        description="How you pay for prints and agent orders."
      >
        <SettingsLinkRow
          href="/dashboard/settings/billing"
          icon={<CreditCardIcon />}
          title="Saved card"
          description="One-tap checkout, and auto-approved agent orders"
          value={row?.defaultPaymentMethod ? "Card on file" : "None"}
        />
      </SettingsGroup>
      <SettingsGroup
        title="Getting paid"
        description="Money from sales of your paid files and projects."
      >
        <SettingsLinkRow
          href="/dashboard/settings/payouts"
          icon={<LandmarkIcon />}
          title="Payouts"
          description="Connect Stripe to receive sales"
          value={payoutValue}
          attention={!row?.stripeOnboardingComplete && !!row?.stripeAccountId}
        />
      </SettingsGroup>
    </div>
  );
}

/**
 * A settings row that navigates: icon badge, title + description, the
 * current state as a trailing value (so the tab answers "is it set
 * up?" without a click), then a chevron.
 */
function SettingsLinkRow({
  href,
  icon,
  title,
  description,
  value,
  attention = false,
}: {
  href: string;
  icon: React.ReactNode;
  title: string;
  description: string;
  value?: string;
  attention?: boolean;
}) {
  return (
    <Link
      href={href}
      className="group -mx-3 flex min-h-16 items-center gap-3 rounded-xl px-3 py-3 transition-colors duration-150 hover:bg-muted/70 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      <span
        aria-hidden="true"
        className="flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-muted text-foreground [&_svg]:size-[18px]"
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm leading-5 font-medium">{title}</span>
        <span className="mt-0.5 block text-[13px] leading-[18px] text-pretty text-muted-foreground">
          {description}
        </span>
      </span>
      {value && (
        <span
          className={
            attention
              ? "shrink-0 text-[13px] text-warning"
              : "shrink-0 text-[13px] text-muted-foreground"
          }
        >
          {value}
        </span>
      )}
      <ChevronRight
        size={14}
        className="shrink-0 text-subtle-foreground transition-colors group-hover:text-foreground"
      />
    </Link>
  );
}
