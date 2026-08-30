import Link from "next/link";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { UploadVisibilitySetting } from "@/app/(app)/dashboard/settings/upload-visibility-setting";
import { EmailNotificationsSetting } from "@/app/(app)/dashboard/settings/email-notifications-setting";
import { SignOutButton } from "@/app/(app)/dashboard/settings/sign-out-button";
import type { EmailPrefMap } from "@/lib/notifications/email-prefs";

export function GeneralSettings({
  defaultUploadVisibility,
  emailNotificationsEnabled,
  emailNotificationPrefs,
}: {
  defaultUploadVisibility: "public" | "private";
  emailNotificationsEnabled: boolean;
  emailNotificationPrefs: EmailPrefMap | null;
}) {
  return (
    <div className="space-y-8">
      <ThemeSwitcher />
      <div className="border-t border-border pt-6">
        <EmailNotificationsSetting
          initial={emailNotificationsEnabled}
          initialPrefs={emailNotificationPrefs}
        />
      </div>
      <UploadVisibilitySetting initial={defaultUploadVisibility} />
      <SignOutButton />
    </div>
  );
}

export function AgentSettings() {
  return (
    <div className="space-y-2">
      <SettingsLink
        href="/dashboard/settings/tokens"
        title="Connected agents"
        description="Personal access tokens for the Materialize MCP server"
      />
    </div>
  );
}

export function PaymentSettings() {
  return (
    <div className="space-y-2">
      <SettingsLink
        href="/dashboard/settings/billing"
        title="Saved card"
        description="Card on file for print checkout and agent orders"
      />
      <SettingsLink
        href="/dashboard/settings/payouts"
        title="Payouts"
        description="Receive payments for paid files and projects"
      />
    </div>
  );
}

function SettingsLink({
  href,
  title,
  description,
}: {
  href: string;
  title: string;
  description: string;
}) {
  return (
    <Link href={href} className="block group">
      <div className="flex items-center justify-between rounded-xl border border-border bg-muted/30 p-4 transition-colors hover:border-primary/30">
        <div>
          <div className="text-sm font-medium transition-colors group-hover:text-primary">
            {title}
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
        </div>
        <span className="text-sm text-muted-foreground">→</span>
      </div>
    </Link>
  );
}
