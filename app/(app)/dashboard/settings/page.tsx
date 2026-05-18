import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { ProfileForm } from "./profile-form";
import { SignOutButton } from "./sign-out-button";
import { UploadVisibilitySetting } from "./upload-visibility-setting";
import { EmailNotificationsSetting } from "./email-notifications-setting";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { ChevronLeft } from "@/components/icons/chevron-left";

export default async function SettingsPage() {
  const { userId } = await auth();
  if (!userId) return null;

  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.id, userId));

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 space-y-8">
      {user?.username && (
        <Link
          href={`/${user.username}`}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronLeft size={16} />
          Profile
        </Link>
      )}

      <h1 className="text-2xl font-bold">Settings</h1>

      <ProfileForm
        initialData={{
          username: user?.username ?? "",
          displayName: user?.displayName ?? "",
          bio: user?.bio ?? "",
          socialLinks: user?.socialLinks ?? [],
        }}
      />

      <ThemeSwitcher />

      <UploadVisibilitySetting
        initial={user?.defaultUploadVisibility ?? "private"}
      />

      <EmailNotificationsSetting
        initial={user?.emailNotificationsEnabled ?? true}
        initialPrefs={user?.emailNotificationPrefs ?? null}
      />

      <div className="border-t border-border pt-6">
        <Link
          href="/dashboard/settings/tokens"
          className="flex items-center justify-between text-sm transition-colors hover:text-foreground"
        >
          <div>
            <div className="font-medium">Connected agents</div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Personal access tokens for the Materialize MCP server
            </p>
          </div>
          <span className="text-muted-foreground">→</span>
        </Link>
      </div>

      <div className="border-t border-border pt-6">
        <Link
          href="/dashboard/settings/billing"
          className="flex items-center justify-between text-sm transition-colors hover:text-foreground"
        >
          <div>
            <div className="font-medium">Billing</div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Saved card for agent-initiated orders
            </p>
          </div>
          <span className="text-muted-foreground">→</span>
        </Link>
      </div>

      <div className="border-t border-border pt-6">
        <Link
          href="/dashboard/settings/payouts"
          className="flex items-center justify-between text-sm transition-colors hover:text-foreground"
        >
          <div>
            <div className="font-medium">Payouts</div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Receive payments for paid files and projects
            </p>
          </div>
          <span className="text-muted-foreground">→</span>
        </Link>
      </div>

      <div className="border-t border-border pt-6">
        <SignOutButton />
      </div>
    </div>
  );
}
