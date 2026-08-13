import { getMyUnreadNotificationCount } from "@/lib/notifications/queries";
import { isSandboxMode } from "@/lib/env";
import { resolveTextToCadAccess } from "@/lib/features";
import { AppShell } from "@/components/nav/app-shell";

export default async function AppLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Server-fetch the unread count once per request; the desktop bell
  // and the mobile-tab bell use this as the initial value and poll
  // for live updates afterwards.
  //
  // Owner-only experimental nav entry. Resolved server-side and threaded
  // down; the page itself re-checks the gate and 404s as a second layer.
  // resolveTextToCadAccess() gates the currentUser() backend call on the
  // env kill-switch first (fast env read, false by default) AND swallows
  // a thrown currentUser() — both matter because this runs on every authed
  // request under /(app) and an unguarded throw 500s the entire page.
  //
  // These two are independent (different data, each already swallows its
  // own errors internally) — run them concurrently instead of serially.
  const [initialUnreadCount, textToCad] = await Promise.all([
    getMyUnreadNotificationCount(),
    resolveTextToCadAccess(),
  ]);
  const sandbox = isSandboxMode();
  return (
    <AppShell
      initialUnreadCount={initialUnreadCount}
      sandbox={sandbox}
      textToCad={textToCad}
    >
      {children}
    </AppShell>
  );
}
