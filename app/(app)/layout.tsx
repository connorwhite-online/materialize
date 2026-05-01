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
            // top:0 — that puts it under the iOS safe-area / status-
            // bar zone too, instead of starting at the safe-area
            // boundary and creating a visible color seam where the
            // blur+bg overlay begins. Page content doesn't render in
            // the safe-area on iOS, so the top portion of the layer
            // is just uniform bg/blur (nothing to soften), and the
            // boundary between safe-area and nav row disappears.
            //
            // h-36 (144px) total. The mask is a 3-stop ease-out so
            // there's no perceptible "edge" where the plateau hands
            // off to the fade — a constant-then-linear curve has a
            // slope discontinuity the eye reads as a soft line.
            // Stops:
            //   0-45%  fully opaque (covers safe-area + the nav row
            //          at h-14 with buffer so the wordmark reads on
            //          a solid backdrop)
            //   45-72% white → 50% alpha (gentle initial decrease)
            //   72-100% 50% alpha → transparent (final tail, blur
            //          dissolves before the eye can pin a boundary)
            //
            // -webkit-mask-image is paired with mask-image so older
            // iOS Safari (<16.4) renders the same mask.
            className="pointer-events-none fixed inset-x-0 top-0 h-36 bg-background/85 backdrop-blur-xl [mask-image:linear-gradient(to_bottom,white_45%,rgb(255_255_255/0.5)_72%,transparent)] [-webkit-mask-image:linear-gradient(to_bottom,white_45%,rgb(255_255_255/0.5)_72%,transparent)]"
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
