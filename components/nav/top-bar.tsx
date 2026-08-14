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
import { cn } from "@/lib/utils";
import { BUBBLE_SHADOW } from "@/components/nav/bubble-shadow";

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
   * Show at every viewport. The landing page has no MobileNav, so
   * it passes this; app routes omit it and hide below the `nav`
   * breakpoint where the tab bar takes over.
   */
  alwaysVisible?: boolean;
}

/**
 * App chrome: brand + optional Prometheus on the left, cmdk search
 * (Print nested in the pill) + Materials in the center, auth cluster
 * on the right. A gradient wash behind the bar feathers page content
 * as it scrolls underneath.
 */
export function TopBar({
  initialUnreadCount,
  textToCad = false,
  alwaysVisible = false,
}: TopBarProps) {
  return (
    <header
      className={cn(
        "pointer-events-none fixed inset-x-0 top-0 z-30",
        alwaysVisible ? "block" : "hidden nav:block"
      )}
    >
      <div
        aria-hidden
        className="absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-background from-35% via-background/80 to-transparent"
      />
      <div
        className={cn(
          "pointer-events-auto relative mx-auto grid max-w-[90rem] items-start gap-3 px-4 pt-4 pb-3 sm:gap-4 sm:px-5",
          alwaysVisible
            ? "grid-cols-[auto_minmax(0,1fr)_auto] nav:grid-cols-[1fr_auto_1fr]"
            : "grid-cols-[1fr_auto_1fr]"
        )}
      >
        <div className="flex items-center gap-3">
          <Link
            href="/"
            aria-label="Materialize — home"
            className="relative flex items-center text-foreground transition-opacity hover:opacity-80"
          >
            {alwaysVisible ? (
              <>
                {/* Landing page: the full lockup drifts in on first paint,
                    but only where the header has room for ~14rem of word.
                    The wrapper does the responsive hiding — `.mz-logo` is
                    unlayered CSS and would outrank a `hidden` utility put
                    on the component itself. */}
                <span className="hidden nav:block">
                  <AnimatedWordmark animateOnMount height={22} />
                </span>
                <Logomark height={22} className="nav:hidden" />
              </>
            ) : (
              <Logomark height={22} />
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

        <div className="flex items-center justify-end pt-0">
          <AuthCluster
            initialUnreadCount={initialUnreadCount}
            subtleLogin={alwaysVisible}
          />
        </div>
      </div>
    </header>
  );
}

function AuthCluster({
  initialUnreadCount,
  subtleLogin = false,
}: {
  initialUnreadCount: number;
  /** Landing page: frosted glass instead of the primary pill. */
  subtleLogin?: boolean;
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
        variant={subtleLogin ? "ghost" : "default"}
        className={cn(
          subtleLogin &&
            "glass text-foreground shadow-none before:hidden hover:bg-glass/90 dark:hover:bg-glass/90"
        )}
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
