import { AuthNav } from "@/components/auth/auth-nav";
import { CartProvider } from "@/components/print/cart-context";
import { CartPanel } from "@/components/print/cart-panel";
import {
  MainMenuSidebar,
  MainMenuTrigger,
} from "@/components/nav/main-menu";
import { NotificationBellServer } from "@/components/notifications/notification-bell-server";

/**
 * Progressive-blur layer table for the mobile header backdrop.
 * Each entry is one stacked div: the blur radius + a mask that
 * defines where on the nav's vertical axis that layer is visible.
 * Heaviest blur sits on top (last in array → highest paint order)
 * and is masked to the upper portion of the nav; lighter blurs
 * fade in below. Adjacent layers' masks overlap so the blur
 * intensity transitions smoothly from heavy → none top to bottom
 * without any single layer's mask edge being a visible boundary.
 *
 * Percentages are along the nav's height (h-16 = 64px). Stops
 * are 4-stop trapezoids (0 → 1 → 1 → 0) except the top layer
 * which is open at the top edge so it covers the very top of
 * the nav at full strength.
 */
const NAV_BLUR_LAYERS: Array<{ blur: number; mask: string }> = [
  // Six layers, blur radius roughly doubling each step. More layers
  // = smaller per-step difference in blur strength = no visible
  // banding between the steps. Each mask is a 4-stop trapezoid with
  // 10% fade-in / fade-out wings that overlap the neighboring
  // layers' wings, so blur intensity glides smoothly from heavy at
  // the top of the nav to none at the bottom.
  {
    blur: 1,
    mask:
      "linear-gradient(to bottom, rgba(0,0,0,0) 60%, rgba(0,0,0,1) 70%, rgba(0,0,0,1) 90%, rgba(0,0,0,0) 100%)",
  },
  {
    blur: 2,
    mask:
      "linear-gradient(to bottom, rgba(0,0,0,0) 50%, rgba(0,0,0,1) 60%, rgba(0,0,0,1) 80%, rgba(0,0,0,0) 90%)",
  },
  {
    blur: 4,
    mask:
      "linear-gradient(to bottom, rgba(0,0,0,0) 40%, rgba(0,0,0,1) 50%, rgba(0,0,0,1) 70%, rgba(0,0,0,0) 85%)",
  },
  {
    blur: 8,
    mask:
      "linear-gradient(to bottom, rgba(0,0,0,0) 30%, rgba(0,0,0,1) 40%, rgba(0,0,0,1) 60%, rgba(0,0,0,0) 80%)",
  },
  // Top two layers have wider fade-in zones than the lower layers
  // so the cumulative blur intensity ramps up gradually from y=0
  // instead of spiking. A short fade-in concentrates the contrast
  // between "no blur" (above the nav) and "full heavy blur" into a
  // few pixels, which the eye reads as a halo line — especially
  // when the page content has dark elements that smear into the
  // ramp zone. Wider fade-ins spread that contrast over more
  // pixels so it never reaches a perceptible threshold.
  {
    blur: 16,
    mask:
      "linear-gradient(to bottom, rgba(0,0,0,0) 5%, rgba(0,0,0,1) 30%, rgba(0,0,0,1) 45%, rgba(0,0,0,0) 65%)",
  },
  {
    blur: 24,
    mask:
      "linear-gradient(to bottom, rgba(0,0,0,0) 0%, rgba(0,0,0,1) 35%, rgba(0,0,0,1) 50%, rgba(0,0,0,0) 70%)",
  },
];

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
            className="pointer-events-none absolute inset-0"
          >
            {/*
              Progressive blur stack — the canonical fix for the
              "two visible bands" problem we kept hitting with a
              single backdrop-filter + mask. A single blurred
              element's halo extends past the mask edge by a few
              pixels, which renders as a second line beside the
              bg-color fade.
              See: kennethnym.com/blog/progressive-blur-in-css and
              devslovecoffee.com/blog/making-apple-progressive-blur-on-web

              Three layers, each with a different blur radius and a
              mask that fades in/out at overlapping vertical bands.
              The strongest blur is on top (covering the upper
              portion of the nav under the wordmark); the lightest
              is at the back (visible only at the bottom of the nav
              before dissolving). The overlapping masks make the
              transition between blur strengths seamless — no
              visible band because no single layer's mask edge is
              the boundary.

              The bg-color gradient sits behind the blur stack so
              the blur diffuses both the page content AND a tint of
              bg-background, giving the nav a unified colored feel
              that fades to transparent at the bottom.
            */}
            <div className="absolute inset-0 bg-gradient-to-b from-background from-50% to-transparent" />
            {NAV_BLUR_LAYERS.map((layer, i) => (
              <div
                key={i}
                className="absolute inset-0"
                style={{
                  backdropFilter: `blur(${layer.blur}px)`,
                  WebkitBackdropFilter: `blur(${layer.blur}px)`,
                  maskImage: layer.mask,
                  WebkitMaskImage: layer.mask,
                }}
              />
            ))}
          </div>
          <div className="relative mx-auto flex h-16 max-w-7xl items-center justify-between px-4">
            <MainMenuTrigger />
            <AuthNav notificationsSlot={<NotificationBellServer />} />
          </div>
        </header>
        <MainMenuSidebar notificationsSlot={<NotificationBellServer />} />
        <main className="flex-1">{children}</main>
        <CartPanel />
      </div>
    </CartProvider>
  );
}
