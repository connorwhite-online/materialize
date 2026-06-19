import { CartProvider } from "@/components/print/cart-context";
import { CartPanel } from "@/components/print/cart-panel";
import { MainMenuSidebar } from "@/components/nav/main-menu";
import { MobileTabBar } from "@/components/nav/mobile-tab-bar";
import { getMyUnreadNotificationCount } from "@/lib/notifications/queries";
import { isSandboxMode } from "@/lib/env";
import { resolveTextToCadAccess } from "@/lib/features";

export default async function AppLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Server-fetch the unread count once per request; the dot indicator
  // on the sidebar avatar uses this as its initial value and the SSE
  // stream picks up the live updates afterwards.
  const initialUnreadCount = await getMyUnreadNotificationCount();
  const sandbox = isSandboxMode();
  // Owner-only experimental nav entry. Resolved server-side and threaded
  // down; the page itself re-checks the gate and 404s as a second layer.
  // resolveTextToCadAccess() gates the currentUser() backend call on the
  // env kill-switch first (fast env read, false by default) AND swallows
  // a thrown currentUser() — both matter because this runs on every authed
  // request under /(app) and an unguarded throw 500s the entire page.
  const textToCad = await resolveTextToCadAccess();
  return (
    <CartProvider>
      {/*
        nav:pl-56 reserves a 14rem gutter on the left for the
        sidebar card to live in. Below the nav breakpoint (1080px,
        defined in globals.css) the rail is hidden and the floating
        MobileTabBar at the bottom carries the same nav. We use a
        custom breakpoint instead of lg (1024px) because at 1024 the
        page feels cramped with both the centered max-w-7xl content
        and the sidebar gutter — by 1080 there's enough room.
      */}
      <div className="flex min-h-screen flex-col nav:pl-56">
        {/*
          Sandbox heads-up. At nav+ it rides inside the sidebar rail
          (passed to MainMenuSidebar); on sub-nav it pips the top-right
          corner of the profile avatar in the MobileTabBar.
        */}
        <MainMenuSidebar
          initialUnreadCount={initialUnreadCount}
          sandbox={sandbox}
          textToCad={textToCad}
        />
        {/*
          Bottom padding on sub-nav reserves space for the floating
          MobileTabBar so the last of the page content isn't trapped
          behind it. Cleared at nav+ where the bar is hidden.
        */}
        <main className="flex-1 pb-28 nav:pb-0">{children}</main>
        <MobileTabBar
          initialUnreadCount={initialUnreadCount}
          textToCad={textToCad}
          sandbox={sandbox}
        />
        <CartPanel />
      </div>
    </CartProvider>
  );
}
