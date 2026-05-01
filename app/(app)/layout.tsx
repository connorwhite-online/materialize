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

          On mobile it's sticky so it survives scroll. The hard line
          separator is replaced with a vertical gradient over a
          backdrop-blur — the bottom edge fades into the page content
          instead of cutting against it, and content scrolling
          underneath is softened by the blur. z-30 puts it above
          page content but below modals/dropdowns.
        */}
        <header className="sticky top-0 z-30 bg-gradient-to-b from-background to-background/0 backdrop-blur-xl lg:hidden">
          <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4">
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
