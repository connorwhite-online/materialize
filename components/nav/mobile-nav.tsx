"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useUser } from "@clerk/nextjs";
import {
  AnimatePresence,
  motion,
  useReducedMotion,
  type PanInfo,
  type Transition,
  type Variants,
} from "motion/react";
import { Grabber } from "@/components/icons/grabber";
import { UserAvatar } from "@/components/auth/user-avatar";
import { Button } from "@/components/ui/button";
import {
  iconSizeProps,
  isDestinationActive,
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
const CARD_OUT: Transition = {
  duration: 0.24,
  ease: [0.4, 0, 0.2, 1],
};
/** Height close waits so the row peel can go soft before clipping. */
const HEIGHT_CLOSE: Transition = { ...CARD_OUT, delay: 0.06 };
/**
 * Width tween for the COLLAPSED card. Mirrors `--mz-crop-ms` and
 * `--ease-out-soft` from globals.css, and that pairing is the whole
 * point: the pill's width is the lockup's width plus constant padding,
 * so running both on the same duration and curve makes them the same
 * animation. Anything else and the pill lags — measured on device at
 * ~65px of clipping for ~230ms mid-reveal.
 *
 * It replaces CARD_OUT here, which still drives the menu's height close.
 * Keep the two within ~20ms of each other or the card's width and height
 * visibly disagree on close.
 */
const CARD_CROP: Transition = { duration: 0.26, ease: [0.22, 0.9, 0.28, 1] };

/** Row lift — same expo-out as the card; no spring asymptote on `y`. */
const ROW_SETTLE: Transition = {
  duration: 0.28,
  ease: [0.22, 1, 0.36, 1],
};

/**
 * The pill ↔ user-container swap on OPEN. Opacity-only (no y) — a
 * slide fought the card's last height pixels and read as bottom-row
 * jitter. Incoming still waits out most of the outgoing fade.
 */
const IDENTITY_IN: Transition = {
  duration: 0.13,
  delay: 0.05,
  ease: [0.32, 0.72, 0, 1],
};
const IDENTITY_OUT: Transition = { duration: 0.07, ease: "easeIn" };
/**
 * Closing: hold the open identity (Login / user) until the menu has
 * actually shrunk. Consecutive close frames showed "Search" printing
 * over "Login" in a still-tall card — the pill identity was swapping
 * on the open-path timing while height was still delayed. Same ease as
 * open; just later, so it lands as the card becomes a pill.
 */
const IDENTITY_IN_CLOSE: Transition = {
  duration: 0.13,
  delay: 0.18,
  ease: [0.32, 0.72, 0, 1],
};
const IDENTITY_OUT_CLOSE: Transition = {
  duration: 0.07,
  delay: 0.1,
  ease: "easeIn",
};

const DRAG_CLOSE_OFFSET = 64;
const DRAG_CLOSE_VELOCITY = 500;

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



  return (
    <>
      <AnimatePresence>
        {open && (
          <motion.button
            type="button"
            // Redundant affordance: pointer users tap out, keyboard and
            // screen-reader users get Escape and the chevron, so this
            // stays out of the accessibility tree entirely.
            tabIndex={-1}
            aria-hidden
            onClick={close}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reducedMotion ? 0 : 0.2 }}
            className="fixed inset-0 z-40 cursor-default bg-background/40 backdrop-blur-[2px] nav:hidden"
          />
        )}
      </AnimatePresence>

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
              // The design system's frosted surface (globals.css), the
              // same fill dialogs and popovers wear: --popover-translucent
              // plus blur + saturate, with a solid --popover fallback
              // where backdrop-filter is unsupported. It replaces a
              // hand-rolled `bg-background/85 backdrop-blur-2xl` that was
              // a near-miss of this treatment — one surface, one recipe.
              // Utilities beat the components layer, so do NOT put a
              // `bg-*` next to it or the translucency is silently lost.
              "glass-surface",
              "ring-1 ring-border/70",
              "shadow-[0_2px_8px_-2px_oklch(0_0_0/0.14),0_18px_44px_-14px_oklch(0_0_0/0.38)]"
            )}
          >
            <AnimatePresence initial={false}>
              {open && (
                <motion.div
                  key="menu"
                  // Opening, the block only animates height — the rows
                  // own their own fade, so there is no phase where a
                  // half-lit card sits on screen waiting for content.
                  // Height is a measured px value (see menuHeight), not
                  // `"auto"`, so the tween can rest without a snap.
                  initial={{ height: 0 }}
                  animate={{ height: menuHeight }}
                  exit={{
                    height: 0,
                    transition: reducedMotion ? { duration: 0 } : HEIGHT_CLOSE,
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
                      initial={reducedMotion ? false : { opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={
                        reducedMotion
                          ? { opacity: 0 }
                          : { opacity: 0, transition: IDENTITY_OUT_CLOSE }
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
                      initial={reducedMotion ? false : { opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={
                        reducedMotion
                          ? { opacity: 0 }
                          : { opacity: 0, transition: IDENTITY_OUT }
                      }
                      transition={reducedMotion ? { duration: 0 } : IDENTITY_IN_CLOSE}
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
    filter: "blur(8px)",
    transition: {
      ...ROW_LEAVE,
      delay,
      opacity: { ...ROW_LEAVE, delay, duration: 0.16 },
      filter: { ...ROW_LEAVE, delay, duration: 0.18 },
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
    filter: "blur(8px)",
    transition: {
      duration: 0.18,
      ease: [0.4, 0, 1, 1],
      opacity: { duration: 0.14, ease: "easeIn" },
      filter: { duration: 0.16, ease: "easeIn" },
    },
  },
  visible: {
    opacity: 1,
    y: 0,
    filter: "blur(0px)",
    transition: {
      y: ROW_SETTLE,
      opacity: { duration: 0.22, ease: EASE_OUT_SOFT },
      filter: { duration: 0.24, ease: EASE_OUT_SOFT },
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
