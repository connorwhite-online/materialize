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
import {
  iconSizeProps,
  isDestinationActive,
  navDestinations,
  resolvePageIdentity,
  type PageIdentity,
} from "@/components/nav/mobile-nav-destinations";
import { useAuthModal } from "@/components/auth/auth-modal";
import { useCart } from "@/components/print/cart-context";
import { useKeyboardOpen } from "@/lib/hooks/use-keyboard-sticky-bottom";
import { useUnreadCount } from "@/lib/hooks/use-unread-count";
import { cn } from "@/lib/utils";

/** Widest the expanded card gets; clamped to the viewport below. */
const MAX_WIDTH = 304;
/** Horizontal breathing room kept either side of the card. */
const VIEWPORT_GUTTER = 32;
/** Floor for a titled collapsed pill so short titles ("Print") aren't stubby. */
const MIN_COLLAPSED_WIDTH = 172;
/** Height of the always-present identity row (`h-14`). */
const ROW_HEIGHT = 56;

/**
 * The card's own motion: fast, with a hair of overshoot and no wobble.
 * Deliberately quicker than the content wave below — filming Linear's
 * nav at 60fps, its card reaches full size in ~100ms and the rows keep
 * arriving for another ~200ms. The container landing early is what
 * makes the cascade read as life rather than lag; when the two finish
 * together (as ours did) the whole thing feels heavier than it is.
 */
const SPRING: Transition = {
  type: "spring",
  stiffness: 520,
  damping: 38,
  mass: 0.8,
};
/** Critically damped — collapsing height must not overshoot past 0. */
const SPRING_CLOSE: Transition = {
  type: "spring",
  stiffness: 460,
  damping: 44,
};

/**
 * Closing height starts almost immediately so the card shrinks *with*
 * the peeling rows instead of waiting until they are gone (which left
 * a blank white card collapsing). A tiny delay lets the first row go
 * soft before anything is clipped.
 */
const HEIGHT_CLOSE: Transition = { ...SPRING_CLOSE, delay: 0.05 };
/**
 * The pill ↔ user-container swap. The incoming row waits out most of
 * the outgoing one's fade, so the two are never both legible — without
 * the delay you catch "Search" and "Connor White" printed over each
 * other mid-collapse.
 */
const IDENTITY_IN: Transition = {
  duration: 0.13,
  delay: 0.05,
  ease: [0.32, 0.72, 0, 1],
};
const IDENTITY_OUT: Transition = { duration: 0.07, ease: "easeIn" };

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

  // Also collapses while the keyboard is up — the whole nav is faded
  // out of the way then, and it must not come back mid-typing.
  const open = openPath !== null && openPath === pathname && !keyboardOpen;
  const close = useCallback(() => setOpenPath(null), []);
  const toggle = useCallback(
    () => setOpenPath((current) => (current === null ? pathname : null)),
    [pathname]
  );

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
          "pointer-events-none fixed inset-x-0 bottom-6 z-50 flex justify-center px-4 nav:hidden",
          "transition-[opacity,transform] duration-200 ease-out motion-reduce:transition-none",
          keyboardOpen && "translate-y-6 opacity-0"
        )}
      >
        {/* Invisible measuring copy of the collapsed row. Same markup,
            same type scale, no `flex-1` — so its intrinsic width is
            exactly what the pill should be for this page title. */}
        <div
          ref={ghostRef}
          aria-hidden
          className="pointer-events-none invisible absolute left-0 top-0 flex items-center"
          style={{ height: ROW_HEIGHT }}
        >
          <PageIdentityContent identity={identity} profile={pillProfile} />
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
            transition={reducedMotion ? { duration: 0 } : open ? SPRING : SPRING_CLOSE}
            drag={open && !reducedMotion ? "y" : false}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0.02, bottom: 0.4 }}
            dragMomentum={false}
            onDragEnd={handleDragEnd}
            className={cn(
              "pointer-events-auto overflow-hidden rounded-[28px]",
              keyboardOpen && "pointer-events-none",
              "bg-background/85 backdrop-blur-2xl",
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
                  initial={{ height: 0 }}
                  animate={{ height: "auto" }}
                  exit={{
                    height: 0,
                    transition: reducedMotion ? { duration: 0 } : HEIGHT_CLOSE,
                  }}
                  transition={reducedMotion ? { duration: 0 } : SPRING_CLOSE}
                  className="overflow-hidden"
                >
                  {/* Fixed width so the list never reflows mid-morph while
                      the card itself is still widening. */}
                  <nav
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
                      initial={reducedMotion ? false : { opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={
                        reducedMotion
                          ? { opacity: 0 }
                          : { opacity: 0, y: -8, transition: IDENTITY_OUT }
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
                        <button
                          type="button"
                          onClick={() => {
                            close();
                            openAuth("sign-in");
                          }}
                          className="mx-1.5 flex min-w-0 flex-1 items-center gap-3 rounded-[22px] px-3 py-2.5 text-left text-[0.9375rem] font-medium transition-colors active:bg-muted/60"
                        >
                          <UserAvatar
                            seed="anonymous"
                            displayName="Sign in"
                            className="h-9 w-9 shrink-0 opacity-60"
                          />
                          <span className="flex-1 truncate">Sign in</span>
                        </button>
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
                      initial={reducedMotion ? false : { opacity: 0, y: -8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={
                        reducedMotion
                          ? { opacity: 0 }
                          : { opacity: 0, y: 8, transition: IDENTITY_OUT }
                      }
                      transition={reducedMotion ? { duration: 0 } : IDENTITY_IN}
                      className="absolute inset-0 flex items-center text-left"
                    >
                      <PageIdentityContent identity={identity} profile={pillProfile} />
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
              itself rather than a mark on the grabber. */}
          {!open && unreadCount > 0 && (
            <span
              aria-hidden
              className="pointer-events-none absolute right-1.5 top-1.5 h-3 w-3 -translate-y-1/2 translate-x-1/2 rounded-full bg-destructive ring-2 ring-background"
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
}: {
  identity: PageIdentity;
  /** Set only on the viewer's own profile page. */
  profile?: PillProfile | null;
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
        <Icon {...iconSizeProps(Icon, 22)} className="shrink-0" />
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
    y: 10,
    scale: 0.98,
    filter: "blur(8px)",
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
 * resolves as they land. Filter is a tween (springs on blur feel
 * drunk); position is a spring so they settle. The travel stays small
 * — at 10px the eye reads it as coming into focus, not as sliding in
 * from somewhere.
 */
const ITEM_VARIANTS: Variants = {
  hidden: {
    opacity: 0,
    y: 10,
    scale: 0.98,
    filter: "blur(8px)",
    transition: {
      duration: 0.22,
      ease: [0.4, 0, 1, 1],
      opacity: { duration: 0.18, ease: "easeIn" },
      filter: { duration: 0.2, ease: "easeIn" },
    },
  },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    filter: "blur(0px)",
    transition: {
      y: { type: "spring", stiffness: 380, damping: 32, mass: 0.7 },
      scale: { type: "spring", stiffness: 380, damping: 32, mass: 0.7 },
      // Logo ease: sharpness catches up a frame after the row has
      // mostly landed, which is the "focus in" the stagger is for.
      opacity: { duration: 0.22, ease: [0.22, 0.9, 0.28, 1] },
      filter: { duration: 0.28, ease: [0.22, 0.9, 0.28, 1] },
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
