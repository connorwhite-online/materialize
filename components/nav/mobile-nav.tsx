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
import { ChevronUp } from "@/components/icons/chevron-up";
import { UserAvatar } from "@/components/auth/user-avatar";
import { SandboxBadge } from "@/components/nav/sandbox-badge";
import {
  iconSizeProps,
  isDestinationActive,
  navDestinations,
  resolvePageIdentity,
  type NavIcon,
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
/** Floor for the collapsed pill so short titles ("Print") aren't stubby. */
const MIN_COLLAPSED_WIDTH = 172;
/** Height of the always-present identity row (`h-14`). */
const ROW_HEIGHT = 56;

/** Open/close motion: a touch of overshoot, no wobble. */
const SPRING: Transition = {
  type: "spring",
  stiffness: 380,
  damping: 32,
  mass: 0.9,
};
/** Critically damped — collapsing height must not overshoot past 0. */
const SPRING_CLOSE: Transition = {
  type: "spring",
  stiffness: 460,
  damping: 44,
};

const DRAG_CLOSE_OFFSET = 64;
const DRAG_CLOSE_VELOCITY = 500;

interface MobileNavProps {
  /** Server-fetched unread notification count for the pip / row badge. */
  initialUnreadCount: number;
  /** Owner-only: append the experimental Text-to-CAD destination. */
  textToCad?: boolean;
  /** True when Stripe is on test keys or CraftCloud is in mock mode. */
  sandbox?: boolean;
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
  sandbox = false,
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

  const { expandedWidth, collapsedWidth, ghostRef } = useNavWidths(identity);

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

  const displayName =
    user?.fullName ||
    user?.username ||
    user?.primaryEmailAddress?.emailAddress ||
    "Profile";

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
          <PageIdentityContent Icon={identity.Icon} label={identity.label} />
          {/* Same trailing content the collapsed pill renders, so the
              measured width accounts for the sandbox chip (the unread
              pip is absolutely positioned and costs no width). */}
          <TrailingCluster
            showPip={unreadCount > 0}
            sandbox={sandbox}
            open={false}
            reducedMotion
            onToggle={undefined}
            menuId={menuId}
          />
        </div>

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
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
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
                    {destinations.map((item) => {
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
                        >
                          <Link
                            href={item.href}
                            onClick={close}
                            aria-current={active ? "page" : undefined}
                            className={cn(
                              "flex items-center gap-3 rounded-[18px] px-3 py-2.5",
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
                                className="min-w-[1.25rem] rounded-full bg-primary px-1.5 py-0.5 text-center text-[0.6875rem] font-semibold leading-none text-primary-foreground"
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
                    initial={reducedMotion ? false : { opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={reducedMotion ? { opacity: 0 } : { opacity: 0, y: -10 }}
                    transition={reducedMotion ? { duration: 0 } : SPRING}
                    className="absolute inset-0 flex items-center"
                  >
                    {isSignedIn && user ? (
                      <Link
                        href={ownProfilePath ?? "/"}
                        onClick={close}
                        aria-current={
                          pathname === ownProfilePath ? "page" : undefined
                        }
                        className="mx-1.5 flex min-w-0 flex-1 items-center gap-2.5 rounded-[18px] p-1 pr-3 transition-colors active:bg-muted/60"
                      >
                        <span className="relative inline-flex shrink-0">
                          <UserAvatar
                            seed={user.username || user.id}
                            imageUrl={user.hasImage ? user.imageUrl : null}
                            displayName={displayName}
                            className="h-9 w-9"
                          />
                          {sandbox && (
                            <SandboxBadge className="absolute -right-1.5 -top-1.5 z-10 p-0.5 ring-2 ring-background" />
                          )}
                        </span>
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
                        className="mx-1.5 flex min-w-0 flex-1 items-center gap-3 rounded-[18px] px-3 py-2.5 text-left text-[0.9375rem] font-medium transition-colors active:bg-muted/60"
                      >
                        <span className="relative inline-flex shrink-0">
                          <UserAvatar
                            seed="anonymous"
                            displayName="Sign in"
                            className="h-9 w-9 opacity-60"
                          />
                          {sandbox && (
                            <SandboxBadge className="absolute -right-1.5 -top-1.5 z-10 p-0.5 ring-2 ring-background" />
                          )}
                        </span>
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
                    initial={reducedMotion ? false : { opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 10 }}
                    transition={reducedMotion ? { duration: 0 } : SPRING}
                    className="absolute inset-0 flex items-center text-left"
                  >
                    <PageIdentityContent
                      Icon={identity.Icon}
                      label={identity.label}
                    />
                  </motion.button>
                )}
              </AnimatePresence>
            </div>

            <TrailingCluster
              showPip={!open && unreadCount > 0}
              sandbox={sandbox && !open}
              open={open}
              reducedMotion={!!reducedMotion}
              onToggle={toggle}
              menuId={menuId}
            />
          </div>
        </motion.div>
      </div>
    </>
  );
}

/** Icon + page title. Shared by the real pill and its measuring ghost. */
function PageIdentityContent({
  Icon,
  label,
}: {
  Icon: NavIcon;
  label: string;
}) {
  return (
    <span className="flex items-center gap-2.5 whitespace-nowrap pl-4 text-[0.9375rem] font-medium text-foreground">
      <Icon {...iconSizeProps(Icon, 20)} className="shrink-0" />
      {label}
    </span>
  );
}

/**
 * Right-hand end of the identity row: the unread pip (collapsed only —
 * the inbox is a menu row when open), the sandbox chip, and the
 * chevron grabber that survives the morph and rotates.
 */
function TrailingCluster({
  showPip,
  sandbox,
  open,
  reducedMotion,
  onToggle,
  menuId,
}: {
  showPip: boolean;
  sandbox: boolean;
  open: boolean;
  reducedMotion: boolean;
  /** Omitted by the measuring ghost, which must not be interactive. */
  onToggle?: () => void;
  menuId: string;
}) {
  return (
    <div className="flex shrink-0 items-center gap-1 pl-2 pr-2.5">
      {sandbox && <SandboxBadge className="p-0.5" />}
      <button
        type="button"
        onClick={onToggle}
        tabIndex={onToggle ? undefined : -1}
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={open ? "Close navigation menu" : "Open navigation menu"}
        className="relative flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-colors active:bg-muted/60"
      >
        {/* Unread pip. Collapsed only — open, the inbox is a menu row
            carrying its own count. */}
        {showPip && (
          <span
            aria-hidden
            className="absolute right-1 top-1 h-2 w-2 rounded-full bg-primary ring-2 ring-background"
          />
        )}
        <motion.span
          animate={{ rotate: open ? 180 : 0 }}
          transition={reducedMotion ? { duration: 0 } : SPRING}
          className="flex"
        >
          <ChevronUp size={18} />
        </motion.span>
      </button>
    </div>
  );
}

const LIST_VARIANTS: Variants = {
  hidden: {},
  // Reveal outward from the pill: the row nearest the bottom edge
  // (the last child) leads.
  visible: {
    transition: { staggerChildren: 0.035, delayChildren: 0.02, staggerDirection: -1 },
  },
};

const ITEM_VARIANTS: Variants = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0, transition: SPRING },
};

/**
 * Widths for both ends of the morph: the expanded card (clamped to the
 * viewport) and the collapsed pill (measured off the invisible ghost,
 * re-measured whenever the page title changes).
 */
function useNavWidths(identity: { label: string; Icon: NavIcon }) {
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
    const measure = () =>
      setCollapsedWidth(
        Math.max(MIN_COLLAPSED_WIDTH, Math.ceil(ghost.getBoundingClientRect().width))
      );
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(ghost);
    return () => observer.disconnect();
  }, [identity.label, identity.Icon]);

  return {
    expandedWidth,
    collapsedWidth: Math.min(collapsedWidth, expandedWidth),
    ghostRef,
  };
}
