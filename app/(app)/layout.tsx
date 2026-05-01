import { AuthNav } from "@/components/auth/auth-nav";
import { CartProvider } from "@/components/print/cart-context";
import { CartPanel } from "@/components/print/cart-panel";
import {
  MainMenuSidebar,
  MainMenuTrigger,
} from "@/components/nav/main-menu";

export default function AppLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <CartProvider>
      {/*
        nav:pl-56 reserves a 14rem gutter on the left for the
        sidebar card to live in. Below the nav breakpoint (1080px,
        defined in globals.css) the rail is hidden and the dropdown
        trigger in the header carries the same nav. We use a custom
        breakpoint instead of lg (1024px) because at 1024 the page
        feels cramped with both the centered max-w-7xl content and
        the sidebar gutter — by 1080 there's enough room.
      */}
      <div className="flex min-h-screen flex-col nav:pl-56">
        {/*
          Header is hidden once the sidebar takes over — at nav+ the
          brand wordmark and the auth controls both live inside the
          rail, and the page content gets the full vertical space.

          On mobile it's a plain sticky bar with a translucent bg +
          backdrop-blur. No mask, no fade tail — earlier iterations
          tried to fade the blur out below the nav for a softer edge,
          but every variation either bled into page content at rest
          or created a visible seam against the safe-area zone.
          html bg-background (set in globals.css) covers the safe-
          area zone in the same color as the nav, so there's no
          visible boundary at rest; when scrolled, content slides
          under the nav and is softened by the blur there.
          z-30 sits above page content but below modals/dropdowns.
        */}
        <header className="sticky top-0 z-30 bg-background/85 backdrop-blur-xl nav:hidden">
          <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4">
            <MainMenuTrigger />
            <AuthNav />
          </div>
        </header>
        <MainMenuSidebar />
        <main className="flex-1">{children}</main>
        <CartPanel />
      </div>
    </CartProvider>
  );
}
