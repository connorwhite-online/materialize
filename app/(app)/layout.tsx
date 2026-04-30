import { AuthNav } from "@/components/auth/auth-nav";
import { CartProvider } from "@/components/print/cart-context";
import { CartPanel } from "@/components/print/cart-panel";
import {
  HeaderBrand,
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
      <div className="flex min-h-screen flex-col">
        <header className="border-b border-border bg-background">
          <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4">
            {/*
              Two header brand surfaces, exactly one visible at a time:
              - <MainMenuTrigger /> (sub-1700): the page-title + caret
                button that opens the dropdown. Single clickable
                surface with a rounded hover bg.
              - <HeaderBrand /> (>= 1700): the static "Materialize"
                wordmark. The sidebar carries the nav at this size,
                so the header brand goes back to being a brand mark.
            */}
            <MainMenuTrigger />
            <HeaderBrand />
            <AuthNav />
          </div>
        </header>
        {/*
          Sidebar lives at the layout root, not nested inside <main>.
          fixed-positioned on the left, only renders at >=1700px — at
          smaller widths it stays hidden and the dropdown trigger in
          the header carries the same nav. Anon home (app/page.tsx)
          uses its own layout and never sees this.
        */}
        <MainMenuSidebar />
        <main className="flex-1">{children}</main>
        <CartPanel />
      </div>
    </CartProvider>
  );
}
