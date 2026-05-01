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
            // h-32 (128px) total. The mask is a 3-stop ease-out so
            // there's no perceptible "edge" where the plateau hands
            // off to the fade — going from constant opacity straight
            // to a linear decrease creates a derivative discontinuity
            // the eye reads as a soft line. Stops:
            //   0-40%  fully opaque (covers the nav row at h-14
            //          plus a small buffer so the wordmark reads
            //          on a solid backdrop)
            //   40-70% white → 50% alpha (gentle initial decrease)
            //   70-100% 50% alpha → transparent (final tail, where
            //          the blur dissolves before the eye can find it)
            //
            // -webkit-mask-image is paired with mask-image so older
            // iOS Safari (<16.4) renders the same mask.
            className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-background/85 backdrop-blur-xl [mask-image:linear-gradient(to_bottom,white_40%,rgb(255_255_255/0.5)_70%,transparent)] [-webkit-mask-image:linear-gradient(to_bottom,white_40%,rgb(255_255_255/0.5)_70%,transparent)]"
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
