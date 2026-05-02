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

          On mobile it's a sticky bar containing a single absolute
          backdrop layer that pairs a linear bg-color gradient with a
          linear mask gradient. Both fade from 100% at the top of the
          nav (where it abuts the safe-area zone — html bg-background
          provides matching color there for a seamless join) down to
          transparent at the bottom of the nav (where it dissolves
          into page content with no hard line). The blur strength is
          uniform but is gated by the mask, so it visually fades in
          lockstep with the bg color. Contained entirely to the nav
          row's footprint — nothing extends past h-16 into page
          content.
          z-30 sits above page content but below modals/dropdowns.
        */}
        <header className="sticky top-0 z-30 nav:hidden">
          <div
            aria-hidden="true"
            // Bg gradient only — no backdrop-filter. Safari's blur
            // implementation has a halo that extends a few px past
            // the masked boundary, which renders as a second visible
            // line beside the bg fade and reads as "two distinct
            // gradients". Dropping the blur eliminates the second
            // band; the colored fade alone still gives a clean
            // separation from page content.
            //
            // Plateau the bg color through the top half of the nav
            // (covers wordmark + avatar on a solid backdrop), then
            // linear fade to transparent across the bottom half.
            className="pointer-events-none absolute inset-0 bg-gradient-to-b from-background from-50% to-transparent"
          />
          <div className="relative mx-auto flex h-16 max-w-7xl items-center justify-between px-4">
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
