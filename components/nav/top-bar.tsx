"use client";

import Link from "next/link";
import { useUser } from "@clerk/nextjs";
import { AnimatedWordmark, Logomark } from "@/components/brand/logo";
import { Galaxy } from "@/components/icons/galaxy";
import { Materials } from "@/components/icons/materials";
import { TopSearch } from "@/components/nav/top-search";
import { NotificationsPopover } from "@/components/nav/notifications-popover";
import { UserAvatar } from "@/components/auth/user-avatar";
import { Button } from "@/components/ui/button";
import { useAuthModal } from "@/components/auth/auth-modal";
import { useWordmarkExpanded } from "@/lib/hooks/use-wordmark-expanded";
import { cn } from "@/lib/utils";
import { BUBBLE_SHADOW } from "@/components/nav/bubble-shadow";

/** Static mark height in app chrome. This one never collapses. */
const NAV_LOGO_HEIGHT = 22;

/**
 * Height of the animated lockup — the size the word wipes in at. The
 * collapsed mark grows past it via `--mz-mark-scale` (globals.css), so
 * these two numbers are a pair: 12px word → 16px mark. Changing this
 * without changing the scale changes where the M lands.
 *
 * Deliberately NOT `NAV_LOGO_HEIGHT`. They were one constant until the
 * lockup was tuned to 11px, at which point bumping it to 22 for the
 * static mark silently doubled the animated one too.
 */
const NAV_WORDMARK_HEIGHT = 12;

const ICON_GLYPH =
  "text-neutral-900 hover:text-neutral-900 dark:text-neutral-100 dark:hover:text-neutral-100";

const ICON_BUBBLE = cn(
  "size-10 shrink-0 rounded-[20px]",
  BUBBLE_SHADOW,
  ICON_GLYPH
);

interface TopBarProps {
  /** Server-fetched unread notification count for the bell. */
  initialUnreadCount: number;
  /** Owner-only: show the experimental Text-to-CAD entry next to the mark. */
  textToCad?: boolean;
  /**
   * Show at every viewport. App routes omit it and hide below the
   * `nav` breakpoint where MobileNav takes over. The anon landing
   * also omits this (it has its own MobileNav) and passes `landing`
   * instead so the desktop wordmark still animates.
   */
  alwaysVisible?: boolean;
  /**
   * Anon marketing home. Desktop shows the animated wordmark (snow-in
   * on load, peel back to the M on scroll) and feathers the hero with
   * a masked backdrop-blur instead of the opaque gradient wash — a
   * white fade over the photo reads as a hard band.
   */
  landing?: boolean;
}

const LANDING_BLUR_MASK =
  "linear-gradient(to bottom, black 0%, black 35%, transparent 100%)";

/**
 * App chrome: brand + optional Prometheus on the left, cmdk search
 * (Print nested in the pill) + Materials in the center, auth cluster
 * on the right. A gradient wash behind the bar feathers page content
 * as it scrolls underneath; the landing hero swaps that for blur.
 */
export function TopBar({
  initialUnreadCount,
  textToCad = false,
  alwaysVisible = false,
  landing = false,
}: TopBarProps) {
  // Undefined until the first scroll, so the snow-in reveal still plays
  // on load; a boolean after that drives collapse (and the reverse
  // expand on the way back up). Shared with the mobile brand pill.
  const wordmarkExpanded = useWordmarkExpanded();
  // Landing dropped `alwaysVisible` when it gained MobileNav; the
  // wordmark still belongs on desktop there. `alwaysVisible` keeps
  // the same lockup for any remaining full-viewport TopBar.
  const animateWordmark = landing || alwaysVisible;

  return (
    <header
      className={cn(
        "pointer-events-none fixed inset-x-0 top-0 z-30",
        alwaysVisible ? "block" : "hidden nav:block"
      )}
    >
      <div
        aria-hidden
        data-nav-feather
        className={
          landing
            ? "absolute inset-x-0 top-0 h-36 backdrop-blur-2xl"
            : "absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-background from-35% via-background/80 to-transparent"
        }
        style={
          landing
            ? {
                maskImage: LANDING_BLUR_MASK,
                WebkitMaskImage: LANDING_BLUR_MASK,
              }
            : undefined
        }
      />
      <div
        className={cn(
          "pointer-events-auto relative mx-auto grid max-w-[90rem] items-start gap-3 px-4 pt-4 pb-3 sm:gap-4 sm:px-5",
          alwaysVisible
            ? "grid-cols-[auto_minmax(0,1fr)_auto] nav:grid-cols-[1fr_auto_1fr]"
            : "grid-cols-[1fr_auto_1fr]"
        )}
      >
        <div className="flex h-10 items-center gap-3">
          <Link
            href="/"
            aria-label="Materialize — home"
            className="relative flex h-10 items-center text-foreground transition-opacity hover:opacity-80"
          >
            {animateWordmark ? (
              <>
                {/* Desktop: the full lockup drifts in on first paint,
                    then peels back to the M on scroll. The wrapper does
                    the responsive hiding — `.mz-logo` is unlayered CSS
                    and would outrank a `hidden` utility put on the
                    component itself. Below `nav` the header falls back
                    to the mark (no room for the word next to search). */}
                <span className="hidden nav:block">
                  <AnimatedWordmark
                    animateOnMount
                    expanded={wordmarkExpanded}
                    height={NAV_WORDMARK_HEIGHT}
                  />
                </span>
                <Logomark height={NAV_LOGO_HEIGHT} className="nav:hidden" />
              </>
            ) : (
              <Logomark height={NAV_LOGO_HEIGHT} />
            )}
          </Link>
          {textToCad && (
            <Button
              variant="ghost"
              size="icon"
              className={ICON_BUBBLE}
              aria-label="Prometheus"
              render={<Link href="/prometheus" />}
            >
              <Galaxy size={20} className="size-5 text-neutral-900 dark:text-neutral-100" />
            </Button>
          )}
        </div>

        <div
          className={cn(
            "flex min-w-0 items-start gap-2",
            alwaysVisible
              ? "w-auto max-w-xl justify-self-center sm:w-[min(36rem,calc(100vw-16rem))]"
              : "w-[min(36rem,calc(100vw-28rem))]"
          )}
        >
          <TopSearch />
          <Button
            variant="ghost"
            size="icon"
            className={ICON_BUBBLE}
            aria-label="Materials"
            render={<Link href="/materials" />}
          >
            <Materials size={20} className="size-5 text-neutral-900 dark:text-neutral-100" />
          </Button>
        </div>

        <div className="flex h-10 items-center justify-end">
          <AuthCluster initialUnreadCount={initialUnreadCount} />
        </div>
      </div>
    </header>
  );
}

function AuthCluster({
  initialUnreadCount,
}: {
  initialUnreadCount: number;
}) {
  const { user, isLoaded, isSignedIn } = useUser();
  const { openAuth } = useAuthModal();

  if (!isLoaded) {
    return <div className="h-10 w-24" />;
  }

  if (!isSignedIn || !user) {
    return (
      <Button
        size="default"
        variant="secondary"
        className="border-border bg-secondary hover:bg-muted"
        onClick={() => openAuth("sign-in")}
      >
        Login
      </Button>
    );
  }

  const displayName =
    user.fullName ||
    user.username ||
    user.primaryEmailAddress?.emailAddress ||
    "Profile";
  const profileHref = user.username ? `/${user.username}` : "/";

  return (
    <div className="flex items-center gap-2">
      <Link
        href={profileHref}
        aria-label="Your profile"
        className={cn(
          "box-border flex h-10 min-w-[12rem] items-center gap-2 overflow-hidden p-1 pr-3 transition-colors",
          BUBBLE_SHADOW
        )}
        style={{ borderRadius: "24px 12px 12px 24px" }}
      >
        <UserAvatar
          seed={user.username || user.id}
          imageUrl={user.hasImage ? user.imageUrl : null}
          displayName={displayName}
          className="h-8 w-8"
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

      <NotificationsPopover
        initialUnreadCount={initialUnreadCount}
        triggerClassName={cn(
          "flex size-10 shrink-0 items-center justify-center overflow-hidden transition-colors",
          BUBBLE_SHADOW,
          ICON_GLYPH
        )}
        triggerStyle={{ borderRadius: "12px 24px 24px 12px" }}
      />
    </div>
  );
}
