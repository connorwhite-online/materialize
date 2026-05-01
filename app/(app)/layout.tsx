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

          On mobile it's sticky so it survives scroll. The blurred
          backdrop is rendered as a separate absolute layer that
          extends ~24px past the nav row and is masked with a vertical
          gradient. backdrop-filter on its own clips cleanly at the
          element box, so even with a fading bg gradient the blur
          itself leaves a visible edge — masking the whole layer is
          what makes the blur dissolve smoothly into the page.
          z-30 sits above page content but below modals/dropdowns.
        */}
        <header className="sticky top-[env(safe-area-inset-top)] z-30 nav:hidden">
          <div
            aria-hidden="true"
            // Layer is fixed at viewport top:0 (with viewport-fit=cover
            // that's the device top, above the safe-area zone), and
            // sized to safe-area-inset-top + 4rem so it covers
            // safe-area + the h-16 nav row + a small 8px buffer below.
            // The continuous coverage from device top through nav row
            // means there's no visible boundary at the safe-area edge.
            //
            // Mask: solid plateau through 100% - 16px, then a quick
            // 16px fade to transparent. The fade lives in the bottom
            // 8px of the nav row (empty space below the wordmark) +
            // the 8px buffer below the nav, so it dissolves into page
            // content without softening any actual content.
            //
            // -webkit-mask-image is paired with mask-image so older
            // iOS Safari (<16.4) renders the same mask.
            className="pointer-events-none fixed inset-x-0 top-0 bg-background/85 backdrop-blur-xl [height:calc(env(safe-area-inset-top)+4rem)] [mask-image:linear-gradient(to_bottom,white,white_calc(100%-16px),transparent)] [-webkit-mask-image:linear-gradient(to_bottom,white,white_calc(100%-16px),transparent)]"
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
