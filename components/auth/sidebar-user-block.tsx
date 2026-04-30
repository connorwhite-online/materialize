"use client";

import Link from "next/link";
import { useUser } from "@clerk/nextjs";
import { Button } from "@/components/ui/button";
import { CartButton } from "@/components/print/cart-button";
import { UserAvatar } from "./user-avatar";
import { useAuthModal } from "./auth-modal";

/**
 * Bottom-of-sidebar auth widget. Replaces the horizontal AuthNav
 * pattern (cart-icon + avatar) with something that fits a vertical
 * rail: anon visitors get a full-width Sign in button; authed users
 * get an avatar + name row that links to their profile (which is
 * also the authed home, so it doubles as a "go home" affordance).
 *
 * The Profile entry that used to live in the nav list is gone -- this
 * block IS the profile link. The cart icon still rides along when
 * populated, sitting above the user row.
 */
export function SidebarUserBlock() {
  const { user, isLoaded, isSignedIn } = useUser();
  const { openAuth } = useAuthModal();

  if (!isLoaded) {
    // Reserve roughly the height of the populated row so the rail
    // doesn't reflow when Clerk finishes loading.
    return <div className="h-12" />;
  }

  if (isSignedIn && user) {
    const displayName =
      user.fullName ||
      user.username ||
      user.primaryEmailAddress?.emailAddress ||
      "Profile";
    const profileHref = user.username ? `/u/${user.username}` : "/";
    return (
      <div className="flex flex-col gap-1.5">
        <CartButton />
        <Link
          href={profileHref}
          aria-label="Your profile"
          className="flex items-center gap-2 rounded-r-2xl rounded-l-full p-1.5 transition-colors hover:bg-muted/50"
        >
          <UserAvatar
            seed={user.username || user.id}
            imageUrl={user.hasImage ? user.imageUrl : null}
            displayName={displayName}
            className="h-8 w-8 shrink-0"
          />
          <div className="min-w-0 flex-1 leading-tight">
            <p className="truncate text-sm font-medium">{displayName}</p>
            {user.username && (
              <p className="truncate text-xs text-muted-foreground">
                @{user.username}
              </p>
            )}
          </div>
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <CartButton />
      <Button
        size="sm"
        className="w-full"
        onClick={() => openAuth("sign-in")}
      >
        Sign in
      </Button>
    </div>
  );
}
