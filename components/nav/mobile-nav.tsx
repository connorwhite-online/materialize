"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useUser } from "@clerk/nextjs";
import {
  AnimatePresence,
  motion,
  useReducedMotion,
  type PanInfo,
  type Transition,
  type Variants,
} from "motion/react";
import { ChevronLeft } from "@/components/icons/chevron-left";
import { Grabber } from "@/components/icons/grabber";
import { UserAvatar } from "@/components/auth/user-avatar";
import { Button } from "@/components/ui/button";
import {
  backFallbackHref,
  iconSizeProps,
  isDestinationActive,
  isNavReachable,
  navDestinations,
  resolvePageIdentity,
  type PageIdentity,
} from "@/components/nav/mobile-nav-destinations";
import { useAuthModal } from "@/components/auth/auth-modal";
import { useCart } from "@/components/print/cart-context";
import { AnimatedWordmark } from "@/components/brand/logo";
import { useWordmarkExpanded } from "@/lib/hooks/use-wordmark-expanded";
import { useKeyboardOpen } from "@/lib/hooks/use-keyboard-sticky-bottom";
import { useUnreadCount } from "@/lib/hooks/use-unread-count";
import { EASE_OUT_SOFT } from "@/lib/motion";
import { cn } from "@/lib/utils";

/** Widest the expanded card gets; clamped to the viewport below. */
const MAX_WIDTH = 304;
/** Horizontal breathing room kept either side of the card. */
const VIEWPORT_GUTTER = 32;
/** Floor for a titled collapsed pill so short titles ("Print") aren't stubby. */
const MIN_COLLAPSED_WIDTH = 172;
/**
 * Height the brand lockup wipes in at on the pill. Same pair as the
 * desktop nav (NAV_WORDMARK_HEIGHT in top-bar.tsx): 10px word, and
 * `--mz-mark-scale` lands the collapsed mark at 16px.
 */
const PILL_WORDMARK_HEIGHT = 10;

/** Height of the always-present identity row (`h-14`). */
const ROW_HEIGHT = 56;

/**
 * Card morph — finite ease-out tweens. Stiffness springs left a long
 * asymptotic crawl of sub-pixel width/height that shimmered the
 * rounded card, backdrop-blur, and labels right before rest. A cubic
 * lands on the target and stops. Deliberately quicker than the row
 * cascade so the container still lands first.
 */
const CARD_IN: Transition = {
  duration: 0.28,
  ease: [0.22, 1, 0.36, 1],
};
/**
 * Width tween for the COLLAPSED card, and — because the two have to be
 * the same animation — the menu's height close as well.
 *
 * It mirrors `--mz-crop-ms` and `--ease-out-soft` from globals.css, and
 * that pairing is the whole point: the pill's width is the lockup's
 * width plus constant padding, so running both on the same duration and
 * curve makes them the same animation. Anything else and the pill lags —
 * measured on device at ~65px of clipping for ~230ms mid-reveal.
 *
 * **Height closes on this too, with no delay.** It used to run its own
 * tween (a 240ms cubic delayed 60ms, "so the row peel can go soft before
 * clipping"), and the delay is what the eye actually caught: filmed at
 * 60fps, the card was **72% collapsed in width while its height had not
 * moved at all**, peaking at an 82-point divergence — it shut sideways
 * into a wide letterbox and only then dropped. Matching durations is not
 * enough either; two curves of the same length still trace different
 * paths. One constant for both is the only version that cannot drift.
 *
 * The rows still peel top → bottom over the top of it, which is coherent
 * because the menu block is `justify-end`: height clips from the top, so
 * the rows being clipped first are the ones already leaving.
 */
const CARD_CROP: Transition = { duration: 0.26, ease: [0.22, 0.9, 0.28, 1] };

/** Row lift — same expo-out as the card; no spring asymptote on `y`. */
const ROW_SETTLE: Transition = {
  duration: 0.28,
  ease: [0.22, 1, 0.36, 1],
};

/**
 * The pill ↔ user-container swap on OPEN. Opacity + blur (no y) — a
 * slide fought the card's last height pixels and read as bottom-row
 * jitter; a bare opacity cut read as a hard swap. Incoming still waits
 * out most of the outgoing fade, and the blur resolves as it lands —
 * the same materialise the menu rows use.
 */
const IDENTITY_IN: Transition = {
  duration: 0.18,
  delay: 0.05,
  ease: [0.32, 0.72, 0, 1],
  opacity: { duration: 0.16, delay: 0.05, ease: EASE_OUT_SOFT },
  filter: { duration: 0.18, delay: 0.05, ease: EASE_OUT_SOFT },
};
const IDENTITY_OUT: Transition = {
  duration: 0.12,
  ease: "easeIn",
  opacity: { duration: 0.1, ease: "easeIn" },
  filter: { duration: 0.12, ease: "easeIn" },
};
/**
 * Closing: hold the open identity (Login / user) until the menu has
 * actually shrunk. Consecutive close frames showed "Search" printing
 * over "Login" in a still-tall card — the pill identity was swapping
 * on the open-path timing while height was still delayed. Same ease as
 * open; just later, so it lands as the card becomes a pill.
 */
const IDENTITY_IN_CLOSE: Transition = {
  duration: 0.18,
  delay: 0.18,
  ease: [0.32, 0.72, 0, 1],
  opacity: { duration: 0.16, delay: 0.18, ease: EASE_OUT_SOFT },
  filter: { duration: 0.18, delay: 0.18, ease: EASE_OUT_SOFT },
};
const IDENTITY_OUT_CLOSE: Transition = {
  duration: 0.12,
  delay: 0.1,
  ease: "easeIn",
  opacity: { duration: 0.1, delay: 0.1, ease: "easeIn" },
  filter: { duration: 0.12, delay: 0.1, ease: "easeIn" },
};

/**
 * Dim + blur the page while the menu is up.
 *
 * Two things made this snap instead of fade:
 * 1. Unmounting via AnimatePresence + a classed `backdrop-blur-*` —
 *    iOS ignores opacity on backdrop-filter, so the page went soft
 *    the frame the node mounted.
 * 2. Tweening `backdropFilter: "blur(Npx)"` strings — Motion does
 *    not interpolate that function reliably, so the radius still
 *    jumped 0 → N in one frame while only the tint faded.
 *
 * The fix: keep the scrim mounted, tween a **numeric** CSS variable
 * for the radius, and let `backdrop-filter: blur(calc(var * 1px))`
 * track it. Opacity and blur then ease on the same open curve.
 */
const SCRIM_BLUR_PX = 10;
/** Unitless px radius — Motion interpolates numbers; `calc` adds the unit. */
const SCRIM_BLUR_VAR = "--mz-scrim-blur";
/**
 * Deliberately NOT the card's expo-out `[0.22, 1, 0.36, 1]`. That curve
 * dumps ~70% of the blur in the first ~50ms, so even a correct
 * interpolation reads as a snap on a 10–15fps screencast (and on
 * device, to the eye). A standard-ease cubic keeps mid-transition
 * softness on screen long enough to read as a fade.
 */
const SCRIM_EASE = [0.4, 0, 0.2, 1] as const;
const SCRIM_IN: Transition = {
  duration: 0.4,
  ease: SCRIM_EASE,
  opacity: { duration: 0.36, ease: SCRIM_EASE },
  [SCRIM_BLUR_VAR]: { duration: 0.4, ease: SCRIM_EASE },
};
const SCRIM_OUT: Transition = {
  duration: 0.32,
  ease: SCRIM_EASE,
  opacity: { duration: 0.28, ease: SCRIM_EASE },
  [SCRIM_BLUR_VAR]: { duration: 0.32, ease: SCRIM_EASE },
};

const DRAG_CLOSE_OFFSET = 64;
const DRAG_CLOSE_VELOCITY = 500;

/**
 * The nav's surface recipe: the design system's frosted fill
 * (`--popover-translucent` + blur/saturate, solid `--popover` where
 * `backdrop-filter` is unsupported), a hairline ring, and the lifted
 * shadow. One constant rather than two class lists, because the card
 * and the back button that oozes out of it have to read as one piece
 * of glass that split — a drift between them is immediately visible.
 *
 * `.glass-surface` lives in `@layer components`, so ANY `bg-*` utility
 * placed beside it silently wins and the surface goes opaque with no
 * error and no failing render. A test pins that.
 */
const NAV_SURFACE = cn(
  "glass-surface",
  "ring-1 ring-border/70",
  "shadow-[0_2px_8px_-2px_oklch(0_0_0/0.14),0_18px_44px_-14px_oklch(0_0_0/0.38)]"
);

/**
 * Same height as the collapsed pill (`ROW_HEIGHT`). A shorter chip sat
 * as a satellite next to the menu; matching them means the button is
 * a circle whose diameter is the pill, so the two read as one piece
 * of glass that split. The grabber inside the pill stays 44px — that's
 * a touch target inside the row, not the row.
 */
const BACK_SIZE = ROW_HEIGHT;
/** Gap it settles at, clear of the card's left edge. */
const BACK_GAP = 8;
/**
 * Enter/exit scale. Origin is the shared edge (`transformOrigin:
 * "right center"`), so the chip grows out of the pill and shrinks back
 * into it rather than popping in place. Kept close to 1 so it doesn't
 * fight the width ooze — the two motions are one "detach".
 */
const BACK_SCALE_FROM = 0.86;
/**
 * The ooze. The button is anchored to the card's left edge and grows
 * leftward out of it: width 0 → BACK_SIZE while its RIGHT corners round
 * from square to half the height, landing as a circle the height of
 * the pill. Square-right reads as a slice of the card itself, so the
 * rounding is what sells it detaching rather than appearing. Scale
 * rides the same curve with origin on that shared edge, so the detach
 * also sizes up out of the menu (and the reverse on the way back in —
 * opening the menu absorbs the chip).
 *
 * Opacity is a SHORTER tween than the width: fading the whole 220ms
 * from 0 hid the ooze entirely and left only a mid-air scale of an
 * already-round chip. Opacity lands early on enter (so the growing
 * slit is visible) and holds longer on exit (so the shrink-into-the-
 * menu still reads before it vanishes).
 *
 * It is positioned absolutely against the card's shrink-wrapper, so
 * none of this moves the pill — the card stays centred in the viewport
 * whether the button is out, oozing, or gone.
 *
 * **The curve is the whole thing, and it is NOT the card's expo-out.**
 * `[0.22, 1, 0.36, 1]` puts almost all its travel up front: filmed on
 * an iPhone at 60fps, the chip was already a third of the way out —
 * detached, past half its final gap — on the FIRST frame after the
 * route committed, so the emergence never happened; then it spent
 * another ~200ms creeping the last 28%. Two defects from one curve: no
 * ooze, and a tail still moving long after the page and the pill title
 * had both cut in a single frame. (The card's own comment warns about
 * exactly this asymptote for springs; an expo-out has it too.)
 *
 * A standard-ease cubic instead. It leaves ~20% of the width in the
 * first quarter of the tween, which is the part that reads as sliding
 * out from under the card, and it lands rather than approaches.
 *
 * Nothing else in this navigation animates — the page swaps in one
 * frame and so does the pill's title — so the chip is the only thing
 * the eye can catch trailing. Keep it under the card's own CARD_IN
 * (280ms); it is one chip, not a container.
 */
const BACK_OOZE_IN: Transition = {
  duration: 0.22,
  ease: [0.4, 0, 0.2, 1],
  opacity: { duration: 0.1, ease: [0.4, 0, 0.2, 1] },
};
const BACK_OOZE_OUT: Transition = {
  duration: 0.16,
  ease: [0.4, 0, 0.2, 1],
  opacity: { duration: 0.1, ease: "easeIn", delay: 0.04 },
};
/**
 * The glyph waits out the first third of the ooze rather than being
 * clipped in half, but lands INSIDE the container's tween — an empty
 * white disc holding for the last frames reads as a missing icon.
 */
const BACK_GLYPH_IN: Transition = {
  duration: 0.1,
  delay: 0.08,
  ease: EASE_OUT_SOFT,
};
const BACK_GLYPH_OUT: Transition = { duration: 0.08, ease: "easeIn" };

interface MobileNavProps {
  /** Server-fetched unread notification count for the pip / row badge. */
  initialUnreadCount: number;
  /** Owner-only: append the experimental Text-to-CAD destination. */
  textToCad?: boolean;
}

/**
 * Mobile primary navigation for sub-`nav` viewports (hidden at nav+,
 * where the desktop top bar takes over).
 *
 * Collapsed it is a single pill: the current page's icon, the page
 * title, and a chevron grabber. Tapping it morphs the same surface —
 * it widens and grows UPWARD from its bottom edge — into a menu card
 * holding the destinations, with the desktop-style avatar/user
 * container taking over the pill's row at the bottom.
 *
 * Why the width is animated as a number instead of `layout`: motion's
 * layout FLIP scale-transforms children across a size change, which
 * visibly stretches the row's text (the same trap documented on
 * `HomeBottomBar`). The collapsed width is measured off an invisible
 * ghost copy of the row (`ghostRef`) so both ends of the animation are
 * real pixel values and nothing is ever scaled.
 */
export function MobileNav({
  initialUnreadCount,
  textToCad = false,
}: MobileNavProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, isLoaded, isSignedIn } = useUser();
  const { openAuth } = useAuthModal();
  const cart = useCart();
  const reducedMotion = useReducedMotion();
  const menuId = useId();
  /**
   * The pathname the menu was opened on, or null when closed. Storing
   * the path (rather than a bare boolean) makes "collapse on navigate"
   * derived state instead of a route-watching effect — the menu simply
   * isn't open for a page it wasn't opened on.
   */
  const [openPath, setOpenPath] = useState<string | null>(null);

  // Fade the whole nav out while the soft keyboard is up so it doesn't
  // float over a raised text field (MTR-212).
  const keyboardOpen = useKeyboardOpen();
  const unreadCount = useUnreadCount(initialUnreadCount, !!isSignedIn);
  const cartCount = cart?.itemCount ?? 0;

  const ownProfilePath = isLoaded && user?.username ? `/${user.username}` : null;
  const identity = resolvePageIdentity(pathname, ownProfilePath);
  const destinations = navDestinations({
    textToCad,
    signedIn: !!isSignedIn,
  });

  /**
   * Anon home swaps the bare mark for the full animated lockup: it
   * wipes in on load and peels back to the mark on scroll, the same
   * gesture the desktop nav makes, driven by the same hook so the two
   * can't drift. Signed-in home keeps the mark — that pill sits over a
   * dashboard, not a hero, and has no wipe-in to justify.
   */
  const wordmarkExpanded = useWordmarkExpanded();
  const brand =
    !isSignedIn && identity.markOnly ? { expanded: wordmarkExpanded } : null;

  const displayName =
    user?.fullName ||
    user?.username ||
    user?.primaryEmailAddress?.emailAddress ||
    "Profile";

  /**
   * On the viewer's own profile the pill wears their face and handle
   * instead of a glyph and the word "Profile" — the page is *them*, and
   * an avatar says that faster than an icon can. `identity.label` still
   * supplies the button's accessible name.
   */
  const pillProfile =
    user && ownProfilePath && pathname === ownProfilePath
      ? {
          seed: user.username || user.id,
          imageUrl: user.hasImage ? user.imageUrl : null,
          displayName,
          handle: user.username
            ? `@${user.username}`
            : (user.primaryEmailAddress?.emailAddress ?? displayName),
        }
      : null;

  const { expandedWidth, collapsedWidth, ghostRef } = useNavWidths(
    identity,
    pillProfile?.handle ?? null
  );

  // Pixel height for the destination list — animating to a number
  // (not `"auto"`) so the tween lands on an exact value instead of
  // snapping from the last interpolated px back to `auto` at rest.
  const menuNavRef = useRef<HTMLElement>(null);
  const [menuHeight, setMenuHeight] = useState(0);

  // Also collapses while the keyboard is up — the whole nav is faded
  // out of the way then, and it must not come back mid-typing.
  const open = openPath !== null && openPath === pathname && !keyboardOpen;
  const close = useCallback(() => setOpenPath(null), []);
  const toggle = useCallback(
    () => setOpenPath((current) => (current === null ? pathname : null)),
    [pathname]
  );

  useLayoutEffect(() => {
    if (!open) {
      setMenuHeight(0);
      return;
    }
    const nav = menuNavRef.current;
    if (!nav) return;
    const measure = () => setMenuHeight(Math.ceil(nav.scrollHeight));
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(nav);
    return () => observer.disconnect();
  }, [open, destinations.length, expandedWidth, isSignedIn]);

  // Escape closes; the page behind stops scrolling while the menu is up.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenPath(null);
    };
    document.addEventListener("keydown", onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  const handleDragEnd = (_: unknown, info: PanInfo) => {
    if (info.offset.y > DRAG_CLOSE_OFFSET || info.velocity.y > DRAG_CLOSE_VELOCITY) {
      close();
    }
  };

  /**
   * Leaf pages — a file, an order, someone else's profile — have no row
   * in the menu, so the only way out is back. The button oozes out of
   * the card's left edge there and retracts everywhere else, including
   * while the menu is open: the menu IS the way out then, and a chip
   * floating beside a full-height card reads as a stray.
   */
  const showBack =
    !open &&
    !isNavReachable(pathname, {
      textToCad,
      signedIn: !!isSignedIn,
      ownProfilePath,
    });
  const fallbackHref = backFallbackHref(pathname);
  const goBack = useCallback(() => {
    // A cold deep link (shared URL, fresh tab) has nothing of ours to
    // pop — stepping back would walk the user off the site — so fall
    // through to the section this page belongs to instead.
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back();
      return;
    }
    router.push(fallbackHref);
  }, [router, fallbackHref]);

  return (
    <>
      {/* Always mounted — see SCRIM_BLUR_VAR. Closed: opacity 0 +
          pointer-events none, so it never steals taps from the page. */}
      <motion.button
        type="button"
        // Redundant affordance: pointer users tap out, keyboard and
        // screen-reader users get Escape and the chevron, so this
        // stays out of the accessibility tree entirely.
        tabIndex={-1}
        aria-hidden
        onClick={close}
        initial={false}
        animate={
          open
            ? { opacity: 1, [SCRIM_BLUR_VAR]: SCRIM_BLUR_PX }
            : { opacity: 0, [SCRIM_BLUR_VAR]: 0 }
        }
        transition={
          reducedMotion ? { duration: 0 } : open ? SCRIM_IN : SCRIM_OUT
        }
        style={{
          // Numeric var → px. Motion tweens the number; the filter
          // tracks it. Fallback 0 so the first paint before Motion
          // writes the var is still sharp.
          backdropFilter: `blur(calc(var(${SCRIM_BLUR_VAR}, 0) * 1px))`,
          WebkitBackdropFilter: `blur(calc(var(${SCRIM_BLUR_VAR}, 0) * 1px))`,
          pointerEvents: open ? "auto" : "none",
        }}
        // No static `backdrop-blur-*` — a classed blur fights the
        // tweened radius and snaps the filter back to full strength.
        className="fixed inset-0 z-40 cursor-default bg-background/40 nav:hidden"
      />

      {/* pointer-events-none on the wrapper so the area beside the nav
          stays click-through to page content; the card re-enables it. */}
      <div
        aria-hidden={keyboardOpen || undefined}
        className={cn(
          "pointer-events-none fixed inset-x-0 z-50 flex justify-center px-4 nav:hidden bottom-[calc(1.5rem+env(safe-area-inset-bottom,0px))]",
          "transition-[opacity,transform] duration-200 ease-out motion-reduce:transition-none",
          keyboardOpen && "translate-y-6 opacity-0"
        )}
      >
        {/* Invisible measuring copy of the collapsed row. Same markup,
            same type scale, no `flex-1` — so its intrinsic width is
            exactly what the pill should be for this page title.

            On the anon brand pill it holds a real <AnimatedWordmark>,
            and `mz-nav-ghost` FREEZES that copy (globals.css) so it
            reports the lockup's final width immediately instead of
            animating. Letting it animate made the card chase a moving
            target: measured on device, the pill ran ~65px narrower than
            its content for ~230ms mid-reveal and clipped the word.
            Frozen, the card runs one tween (CARD_CROP) on the crop's own
            duration and curve, so pill and word expand as one. */}
        <div
          ref={ghostRef}
          aria-hidden
          className="mz-nav-ghost pointer-events-none invisible absolute left-0 top-0 flex items-center"
          style={{ height: ROW_HEIGHT }}
        >
          <PageIdentityContent
            identity={identity}
            profile={pillProfile}
            brand={brand}
          />
          {/* Same trailing content the collapsed pill renders — the
              grabber costs width, so it has to be in the measurement.
              (The pip hangs off the card's edge and costs none.) */}
          <TrailingCluster onToggle={undefined} menuId={menuId} />
        </div>

        {/* `relative` shrink-wrapper around the card. The pip below
            hangs off the card's edge, and the card clips its own
            overflow (the height animation needs that), so the pip
            cannot live inside it. */}
        <div className="relative">
          <motion.div
            initial={false}
            animate={{ width: open ? expandedWidth : collapsedWidth }}
            transition={
              reducedMotion ? { duration: 0 } : open ? CARD_IN : CARD_CROP
            }
            drag={open && !reducedMotion ? "y" : false}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0.02, bottom: 0.4 }}
            dragMomentum={false}
            onDragEnd={handleDragEnd}
            className={cn(
              "pointer-events-auto overflow-hidden rounded-[28px]",
              keyboardOpen && "pointer-events-none",
              // Frosted fill + ring + shadow, shared with the back
              // button (see NAV_SURFACE). Utilities beat the components
              // layer, so do NOT put a `bg-*` next to it or the
              // translucency is silently lost.
              NAV_SURFACE
            )}
          >
            <AnimatePresence initial={false}>
              {open && (
                <motion.div
                  key="menu"
                  // Opening, the block only animates height — the rows
                  // own their own fade + blur, so there is no phase
                  // where a half-lit card sits on screen waiting for
                  // content. Closing, fade the whole block with the
                  // crop so the divider and any mid-peel rows don't
                  // hard-cut as height collapses. Height is a measured
                  // px value (see menuHeight), not `"auto"`, so the
                  // tween can rest without a snap.
                  initial={{ height: 0, opacity: 1 }}
                  animate={{ height: menuHeight, opacity: 1 }}
                  exit={{
                    height: 0,
                    opacity: 0,
                    // The same tween the card's width is running — see
                    // CARD_CROP. Not merely the same duration: the same
                    // object, so the two can never diverge. Opacity
                    // rides a slightly shorter ease-in so the soft
                    // exit leads the clip by a frame or two.
                    transition: reducedMotion
                      ? { duration: 0 }
                      : {
                          ...CARD_CROP,
                          opacity: { duration: 0.16, ease: "easeIn" },
                        },
                  }}
                  transition={reducedMotion ? { duration: 0 } : CARD_IN}
                  // Stick the list to the pill. Height shrinks the box
                  // from the top, so Home is clipped first and Materials
                  // stays parked next to the identity — the other way
                  // shears the bottom rows and is what read as jitter.
                  className="flex flex-col justify-end overflow-hidden"
                >
                  {/* Fixed width so the list never reflows mid-morph while
                      the card itself is still widening. */}
                  <nav
                    ref={menuNavRef}
                    id={menuId}
                    aria-label="Primary"
                    style={{ width: expandedWidth }}
                  >
                    <motion.ul
                      variants={LIST_VARIANTS}
                      initial="hidden"
                      animate="visible"
                      className="flex flex-col gap-0.5 p-1.5"
                    >
                      {destinations.map((item, index) => {
                        const active = isDestinationActive(pathname, item.href);
                        const badge =
                          item.href === "/print" && cartCount > 0
                            ? cartCount
                            : item.href === "/notifications" && unreadCount > 0
                              ? unreadCount
                              : 0;
                        const { Icon } = item;
                        return (
                          <motion.li
                            key={item.href}
                            variants={reducedMotion ? undefined : ITEM_VARIANTS}
                            exit={reducedMotion ? undefined : rowExit(index)}
                          >
                            <Link
                              href={item.href}
                              onClick={close}
                              aria-current={active ? "page" : undefined}
                              className={cn(
                                "flex items-center gap-3 rounded-[22px] px-3 py-2.5",
                                "text-[0.9375rem] font-medium transition-colors",
                                active
                                  ? "bg-muted text-foreground"
                                  : "text-muted-foreground active:bg-muted/60"
                              )}
                            >
                              <Icon
                                {...iconSizeProps(Icon, 20)}
                                className="shrink-0"
                              />
                              <span className="flex-1 truncate">{item.label}</span>
                              {badge > 0 && (
                                <span
                                  className={cn(
                                    "min-w-[1.375rem] rounded-full px-2 py-1 text-center text-[0.6875rem] font-semibold leading-none",
                                    // Same red as the collapsed pill's
                                    // pip — one colour means "unread"
                                    // wherever you meet it. `text-background`
                                    // rather than a fixed white: the dark
                                    // theme's red is light enough that white
                                    // on it stops being legible.
                                    item.href === "/notifications"
                                      ? "bg-destructive text-background"
                                      : "bg-primary text-primary-foreground"
                                  )}
                                  aria-label={
                                    item.href === "/print"
                                      ? `${badge} in cart`
                                      : `${badge} unread`
                                  }
                                >
                                  {badge > 99 ? "99+" : badge}
                                </span>
                              )}
                            </Link>
                          </motion.li>
                        );
                      })}
                    </motion.ul>
                    <div className="mx-3 h-px bg-border" />
                  </nav>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Identity row — always present. It is the pill when closed
                and the user container when open; the chevron persists
                across both and just rotates. */}
            <div className="flex items-center" style={{ height: ROW_HEIGHT }}>
              <div className="relative min-w-0 flex-1 self-stretch">
                <AnimatePresence initial={false}>
                  {open ? (
                    <motion.div
                      key="user"
                      initial={
                        reducedMotion
                          ? false
                          : { opacity: 0, filter: "blur(6px)" }
                      }
                      animate={{ opacity: 1, filter: "blur(0px)" }}
                      exit={
                        reducedMotion
                          ? { opacity: 0 }
                          : {
                              opacity: 0,
                              filter: "blur(6px)",
                              transition: IDENTITY_OUT_CLOSE,
                            }
                      }
                      transition={reducedMotion ? { duration: 0 } : IDENTITY_IN}
                      className="absolute inset-0 flex items-center"
                    >
                      {isSignedIn && user ? (
                        <Link
                          href={ownProfilePath ?? "/"}
                          onClick={close}
                          aria-current={
                            pathname === ownProfilePath ? "page" : undefined
                          }
                          className="mx-1.5 flex min-w-0 flex-1 items-center gap-2.5 rounded-[22px] p-1 pr-3 transition-colors active:bg-muted/60"
                        >
                          <UserAvatar
                            seed={user.username || user.id}
                            imageUrl={user.hasImage ? user.imageUrl : null}
                            displayName={displayName}
                            className="h-9 w-9 shrink-0"
                          />
                          <span className="min-w-0 flex-1 leading-tight">
                            <span className="block truncate text-sm font-medium">
                              {displayName}
                            </span>
                            {user.username && (
                              <span className="block truncate text-xs text-muted-foreground">
                                @{user.username}
                              </span>
                            )}
                          </span>
                        </Link>
                      ) : (
                        <div className="mx-1.5 flex min-w-0 flex-1 items-center">
                          <Button
                            size="default"
                            variant="secondary"
                            className="w-full border-border bg-secondary hover:bg-muted"
                            onClick={() => {
                              close();
                              openAuth("sign-in");
                            }}
                          >
                            Login
                          </Button>
                        </div>
                      )}
                    </motion.div>
                  ) : (
                    <motion.button
                      key="page"
                      type="button"
                      onClick={() => setOpenPath(pathname)}
                      aria-expanded={false}
                      aria-controls={menuId}
                      aria-label={`${identity.label} — open navigation menu`}
                      initial={
                        reducedMotion
                          ? false
                          : { opacity: 0, filter: "blur(6px)" }
                      }
                      animate={{ opacity: 1, filter: "blur(0px)" }}
                      exit={
                        reducedMotion
                          ? { opacity: 0 }
                          : {
                              opacity: 0,
                              filter: "blur(6px)",
                              transition: IDENTITY_OUT,
                            }
                      }
                      transition={
                        reducedMotion ? { duration: 0 } : IDENTITY_IN_CLOSE
                      }
                      className="absolute inset-0 flex items-center text-left"
                    >
                      <PageIdentityContent
                        identity={identity}
                        profile={pillProfile}
                        brand={brand}
                      />
                    </motion.button>
                  )}
                </AnimatePresence>
              </div>

              <TrailingCluster open={open} onToggle={toggle} menuId={menuId} />
            </div>
          </motion.div>

          {/* Unread pip — collapsed only; once open, the inbox is a menu
              row carrying its own count. It straddles the pill's
              top-right edge at 45°, so it reads as a badge on the nav
              itself rather than a mark on the grabber. `mz-nav-pip`
              (globals.css) holds it invisible for the card's own crop
              duration so it doesn't co-animate with a still-shrinking
              pill, then lands with a fade + spring scale once the
              collapse has actually settled. */}
          {!open && unreadCount > 0 && (
            <span
              aria-hidden
              className="mz-nav-pip pointer-events-none absolute right-1.5 top-1.5 h-3 w-3 -translate-y-1/2 translate-x-1/2 rounded-full bg-destructive ring-2 ring-background"
            />
          )}

          {/* Back button — see `showBack`. Absolutely positioned against
              this same shrink-wrapper and flush with the identity row
              (same height, `bottom: 0`), so it costs the card no layout:
              the pill stays exactly where it is whether the button is
              out or not.

              `overflow-hidden` is what makes the ooze read — the glyph is
              clipped by the growing width instead of squashing — and the
              left corners stay a static half-height while only the RIGHT
              pair animates 0 → BACK_SIZE/2 inline. Scale originates on
              that shared edge (`transformOrigin: "right center"`) so the
              chip grows out of the menu and shrinks back into it. */}
          <AnimatePresence>
            {showBack && (
              <motion.button
                key="back"
                type="button"
                onClick={goBack}
                aria-label="Go back"
                initial={{
                  width: 0,
                  marginRight: 0,
                  borderTopRightRadius: 0,
                  borderBottomRightRadius: 0,
                  scale: BACK_SCALE_FROM,
                  opacity: 0,
                }}
                animate={{
                  width: BACK_SIZE,
                  marginRight: BACK_GAP,
                  borderTopRightRadius: BACK_SIZE / 2,
                  borderBottomRightRadius: BACK_SIZE / 2,
                  scale: 1,
                  opacity: 1,
                }}
                exit={{
                  width: 0,
                  marginRight: 0,
                  borderTopRightRadius: 0,
                  borderBottomRightRadius: 0,
                  scale: BACK_SCALE_FROM,
                  opacity: 0,
                  transition: reducedMotion ? { duration: 0 } : BACK_OOZE_OUT,
                }}
                transition={reducedMotion ? { duration: 0 } : BACK_OOZE_IN}
                style={{
                  height: BACK_SIZE,
                  bottom: 0,
                  // Grow out of / shrink into the pill, not in place.
                  // CSS transform-origin (not Motion's originX) so it
                  // can't be dropped when width is also animating.
                  transformOrigin: "right center",
                  // NOT `rounded-l-full`. Tailwind's `full` is an
                  // effectively infinite radius, and when the radii on
                  // one edge overrun the box CSS scales EVERY corner by
                  // the same factor — so an infinite left pair crushed
                  // the animated right pair to ~0 and the button settled
                  // as a hard vertical cut. Filmed; the computed style
                  // still reported 22px, because that resolution happens
                  // at use time. Half the height is the same semicircle
                  // without poisoning the scale.
                  borderTopLeftRadius: BACK_SIZE / 2,
                  borderBottomLeftRadius: BACK_SIZE / 2,
                }}
                className={cn(
                  "pointer-events-auto absolute right-full flex items-center justify-center",
                  "overflow-hidden text-muted-foreground",
                  "transition-colors active:text-foreground",
                  keyboardOpen && "pointer-events-none",
                  NAV_SURFACE
                )}
              >
                <motion.span
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{
                    opacity: 0,
                    transition: reducedMotion ? { duration: 0 } : BACK_GLYPH_OUT,
                  }}
                  transition={reducedMotion ? { duration: 0 } : BACK_GLYPH_IN}
                  className="flex shrink-0 items-center justify-center"
                >
                  <ChevronLeft size={20} />
                </motion.span>
              </motion.button>
            )}
          </AnimatePresence>
        </div>
      </div>
    </>
  );
}

type PillProfile = {
  seed: string;
  imageUrl: string | null;
  displayName: string;
  handle: string;
};

/**
 * Icon + page title. Shared by the real pill and its measuring ghost.
 *
 * Home is `markOnly`: the logomark carries the meaning on its own, so
 * the pill drops the word and sizes the mark up a little to fill the
 * space the title would have taken. The button around this still names
 * itself "Home — open navigation menu" for assistive tech.
 */
function PageIdentityContent({
  identity,
  profile,
  brand,
}: {
  identity: PageIdentity;
  /** Set only on the viewer's own profile page. */
  profile?: PillProfile | null;
  /**
   * Set only on the anon brand pill, where the mark is replaced by the
   * animated lockup. `expanded` is `undefined` while the wipe-in plays
   * (see useWordmarkExpanded), so the flag has to be its own object —
   * "not a brand pill" and "brand pill, still mounting" both read as
   * undefined otherwise.
   */
  brand?: { expanded: boolean | undefined } | null;
}) {
  const { Icon, label, markOnly } = identity;
  if (profile) {
    return (
      <span className="flex items-center gap-2.5 whitespace-nowrap pl-2 text-[0.9375rem] font-medium text-foreground">
        <UserAvatar
          seed={profile.seed}
          imageUrl={profile.imageUrl}
          displayName={profile.displayName}
          className="h-8 w-8 shrink-0"
        />
        {/* Capped, not wrapped: a long handle — or an email, when there
            is no username — must not stretch the pill across the
            viewport. The cap applies to the measuring ghost too, so the
            pill's width lands on the truncated text. */}
        <span className="max-w-[8.5rem] truncate">{profile.handle}</span>
      </span>
    );
  }
  if (markOnly) {
    return (
      <span className="flex items-center pl-4 text-foreground">
        {brand ? (
          // The lockup sizes and crops itself off --mz-h; no width
          // classes here, or they would fight the CSS that animates it.
          <AnimatedWordmark
            animateOnMount
            expanded={brand.expanded}
            height={PILL_WORDMARK_HEIGHT}
          />
        ) : (
          <Icon {...iconSizeProps(Icon, 22)} className="shrink-0" />
        )}
      </span>
    );
  }
  return (
    <span className="flex items-center gap-2.5 whitespace-nowrap pl-4 text-[0.9375rem] font-medium text-foreground">
      <Icon {...iconSizeProps(Icon, 20)} className="shrink-0" />
      {label}
    </span>
  );
}

/**
 * Right-hand end of the identity row: the grabber. It reads the same
 * open or closed, so unlike a lone chevron it has nothing to rotate.
 */
function TrailingCluster({
  open = false,
  onToggle,
  menuId,
}: {
  open?: boolean;
  /** Omitted by the measuring ghost, which must not be interactive. */
  onToggle?: () => void;
  menuId: string;
}) {
  return (
    <div className="flex shrink-0 items-center pl-1 pr-1.5">
      <button
        type="button"
        onClick={onToggle}
        tabIndex={onToggle ? undefined : -1}
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={open ? "Close navigation menu" : "Open navigation menu"}
        // 44px is the smallest comfortable touch target, and this one
        // opens and closes the whole nav. The glyph stays optically
        // small; the padding does the work.
        className="flex h-11 w-11 items-center justify-center rounded-full text-muted-foreground transition-colors active:bg-muted/60"
      >
        <Grabber size={24} />
      </button>
    </div>
  );
}

/** Wordmark `--mz-stagger-in` — readable cascade, not a simultaneous pop. */
const STAGGER_IN = 0.038;
/** Close peels a hair slower than the wordmark's 24ms so the wave reads. */
const STAGGER_OUT = 0.032;

const LIST_VARIANTS: Variants = {
  hidden: {},
  // Reveal outward from the pill: last child (nearest the bottom
  // edge) leads. No `delayChildren` — the first row starts with the
  // card, or the card reads as an empty box.
  visible: {
    transition: { staggerChildren: STAGGER_IN, staggerDirection: -1 },
  },
};

const ROW_LEAVE: Transition = {
  duration: 0.22,
  ease: [0.4, 0, 1, 1],
};

/**
 * Close target with the delay baked in. AnimatePresence resolves
 * function variants using `presenceContext.custom`, not the child's
 * `custom` prop, so a per-item function delay always came out 0.
 * An object `exit` with `delay: index * STAGGER_OUT` is the stagger.
 */
function rowExit(index: number) {
  const delay = index * STAGGER_OUT;
  return {
    opacity: 0,
    y: 6,
    filter: "blur(10px)",
    transition: {
      ...ROW_LEAVE,
      delay,
      opacity: { ...ROW_LEAVE, delay, duration: 0.18 },
      filter: { ...ROW_LEAVE, delay, duration: 0.2 },
    },
  };
}

/**
 * Rows materialise rather than slide: a short lift plus a blur that
 * resolves as they land. Both are finite tweens — springs left a
 * sub-pixel crawl on `y` that re-rasterised glyphs each frame and
 * read as jitter right before rest. No `scale` — scaling type inside
 * a height box is what made close frames jitter as the browser
 * relaid out each flex row. Travel stays small (8px) so the eye
 * reads focus-in, not a slide from elsewhere.
 */
const ITEM_VARIANTS: Variants = {
  hidden: {
    opacity: 0,
    y: 8,
    filter: "blur(10px)",
    transition: {
      duration: 0.2,
      ease: [0.4, 0, 1, 1],
      opacity: { duration: 0.16, ease: "easeIn" },
      filter: { duration: 0.18, ease: "easeIn" },
    },
  },
  visible: {
    opacity: 1,
    y: 0,
    filter: "blur(0px)",
    transition: {
      y: ROW_SETTLE,
      opacity: { duration: 0.26, ease: EASE_OUT_SOFT },
      filter: { duration: 0.3, ease: EASE_OUT_SOFT },
    },
  },
};

/**
 * Widths for both ends of the morph: the expanded card (clamped to the
 * viewport) and the collapsed pill (measured off the invisible ghost,
 * re-measured whenever the page title changes).
 */
function useNavWidths(identity: PageIdentity, profileHandle: string | null) {
  const ghostRef = useRef<HTMLDivElement>(null);
  const [expandedWidth, setExpandedWidth] = useState(MAX_WIDTH);
  const [collapsedWidth, setCollapsedWidth] = useState(MIN_COLLAPSED_WIDTH);

  useEffect(() => {
    const measureViewport = () =>
      setExpandedWidth(
        Math.min(MAX_WIDTH, window.innerWidth - VIEWPORT_GUTTER)
      );
    measureViewport();
    window.addEventListener("resize", measureViewport);
    return () => window.removeEventListener("resize", measureViewport);
  }, []);

  // Layout effect + a ResizeObserver: the label changes on every
  // navigation, and web fonts can land after first paint.
  useLayoutEffect(() => {
    const ghost = ghostRef.current;
    if (!ghost) return;
    // A mark-only pill (Home) skips the floor — padding an icon out to
    // title width would leave it swimming in empty space.
    const floor = identity.markOnly ? 0 : MIN_COLLAPSED_WIDTH;
    const measure = () =>
      setCollapsedWidth(
        Math.max(floor, Math.ceil(ghost.getBoundingClientRect().width))
      );
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(ghost);
    return () => observer.disconnect();
  }, [identity.label, identity.Icon, identity.markOnly, profileHandle]);

  return {
    expandedWidth,
    collapsedWidth: Math.min(collapsedWidth, expandedWidth),
    ghostRef,
  };
}
