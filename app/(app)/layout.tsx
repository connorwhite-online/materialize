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
            // Fixed (not absolute) so the layer anchors to viewport
            // top:0 and covers the iOS safe-area zone alongside the
            // nav row in one continuous treatment.
            //
            // The mask feathers BOTH ends so the layer never has a
            // hard edge against the page below or against the safe-
            // area zone above. h-36 (144px) gives enough room for a
            // typical iPhone-Pro safe-area (~62px) + nav row (56px)
            // plus a tail short enough to live in the gap between
            // the nav row and the first page-content element (which
            // sits below the page wrapper's py-8 padding).
            //
            //   0-7%   transparent → full (top fade-in, hides the
            //          subpixel boundary between blur and the html
            //          bg in the safe-area zone)
            //   7-78%  fully opaque plateau (covers safe-area + the
            //          full nav row so wordmark reads cleanly)
            //   78-88% 1.0 → 0.6 alpha (gentle initial decrease)
            //   88-96% 0.6 → 0.15 alpha (steeper middle)
            //   96-100% 0.15 → transparent (final tail asymptotes
            //          out before the eye can pin a boundary)
            //
            // -webkit-mask-image is paired with mask-image so older
            // iOS Safari (<16.4) renders the same mask.
            className="pointer-events-none fixed inset-x-0 top-0 h-36 bg-background/85 backdrop-blur-xl [mask-image:linear-gradient(to_bottom,transparent,white_7%,white_78%,rgb(255_255_255/0.6)_88%,rgb(255_255_255/0.15)_96%,transparent)] [-webkit-mask-image:linear-gradient(to_bottom,transparent,white_7%,white_78%,rgb(255_255_255/0.6)_88%,rgb(255_255_255/0.15)_96%,transparent)]"
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
