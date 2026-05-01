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
        lg:pl-56 reserves a 14rem gutter on the left for the
        sidebar card to live in. Below lg the rail is hidden and
        the dropdown trigger in the header carries the same nav.
      */}
      <div className="flex min-h-screen flex-col lg:pl-56">
        {/*
          Header is hidden once the sidebar takes over — at lg+ the
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
        <header className="sticky top-0 z-30 lg:hidden">
          <div
            aria-hidden="true"
            // Layer is sized to exactly safe-area-inset-top + the
            // 3.5rem (h-14) nav row, so the blur is contained to the
            // menu container and never extends past the nav row's
            // own bottom edge into page content. env() makes the
            // height device-aware — iPhone SE (~20px safe-area) and
            // iPhone Pro (~60px) both end up snug.
            //
            // Mask: solid plateau through 100% - 16px, then a quick
            // 16px fade to transparent. The fade lives entirely
            // inside the bottom of the nav row (where there's just
            // background, no nav text or avatar — those are
            // vertically centered higher up), so it dissolves
            // smoothly into the page content directly below without
            // softening any actual content.
            //
            // -webkit-mask-image is paired with mask-image so older
            // iOS Safari (<16.4) renders the same mask.
            className="pointer-events-none fixed inset-x-0 top-0 bg-background/85 backdrop-blur-xl [height:calc(env(safe-area-inset-top)+3.5rem)] [mask-image:linear-gradient(to_bottom,white,white_calc(100%-16px),transparent)] [-webkit-mask-image:linear-gradient(to_bottom,white,white_calc(100%-16px),transparent)]"
          />
          <div className="relative mx-auto flex h-14 max-w-7xl items-center justify-between px-4">
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
