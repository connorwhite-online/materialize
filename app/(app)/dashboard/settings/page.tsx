import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { ProfileForm } from "./profile-form";
import { ThemeSwitcher } from "@/components/theme-switcher";

export default async function SettingsPage() {
  const { userId } = await auth();
  if (!userId) return null;

  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.id, userId));

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 space-y-8">
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
    </div>
  );
}
