import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { ProfileForm } from "./profile-form";
import { SignOutButton } from "./sign-out-button";
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
          href={`/u/${user.username}`}
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

      <div className="border-t border-border pt-6">
        <SignOutButton />
      </div>
    </div>
  );
}
