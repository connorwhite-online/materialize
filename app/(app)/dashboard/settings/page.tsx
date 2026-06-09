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
          avatarUrl: user?.avatarUrl ?? null,
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

      <div className="space-y-2">
        <Link href="/dashboard/settings/tokens" className="block group">
          <div className="flex items-center justify-between rounded-xl border border-border p-4 transition-colors hover:border-primary/30">
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="7.5" cy="15.5" r="5.5"/>
                  <path d="M21 2l-9.6 9.6"/>
                  <path d="M15.5 7.5l3 3L22 7l-3-3"/>
                </svg>
              </div>
              <div>
                <div className="text-sm font-medium transition-colors group-hover:text-primary">Connected agents</div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Personal access tokens for the Materialize MCP server
                </p>
              </div>
            </div>
            <span className="text-muted-foreground text-sm">→</span>
          </div>
        </Link>

        <Link href="/dashboard/settings/billing" className="block group">
          <div className="flex items-center justify-between rounded-xl border border-border p-4 transition-colors hover:border-primary/30">
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <rect x="1" y="4" width="22" height="16" rx="2" ry="2"/>
                  <line x1="1" y1="10" x2="23" y2="10"/>
                </svg>
              </div>
              <div>
                <div className="text-sm font-medium transition-colors group-hover:text-primary">Billing</div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Saved card for agent-initiated orders
                </p>
              </div>
            </div>
            <span className="text-muted-foreground text-sm">→</span>
          </div>
        </Link>

        <Link href="/dashboard/settings/payouts" className="block group">
          <div className="flex items-center justify-between rounded-xl border border-border p-4 transition-colors hover:border-primary/30">
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M2 17V7a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2z"/>
                  <path d="M22 12H17a2 2 0 0 0 0 4h5"/>
                </svg>
              </div>
              <div>
                <div className="text-sm font-medium transition-colors group-hover:text-primary">Payouts</div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Receive payments for paid files and projects
                </p>
              </div>
            </div>
            <span className="text-muted-foreground text-sm">→</span>
          </div>
        </Link>
      </div>

      <SignOutButton />
    </div>
  );
}
