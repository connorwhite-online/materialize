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
            className="pointer-events-none absolute inset-x-0 top-0 h-20 bg-gradient-to-b from-background to-background/0 backdrop-blur-xl [mask-image:linear-gradient(to_bottom,white_70%,transparent)]"
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
