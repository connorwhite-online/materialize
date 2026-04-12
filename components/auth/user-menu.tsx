"use client";

import Link from "next/link";
import { useUser } from "@clerk/nextjs";
import { UserAvatar } from "./user-avatar";

/**
 * Avatar in nav that links directly to the user's profile.
 * No dropdown — sign-out and settings live inside the profile page.
 */
export function UserMenu() {
  const { user, isLoaded } = useUser();

  if (!isLoaded || !user) return null;

  // Username might not be set yet if onboarding wasn't completed
  const profileHref = user.username ? `/u/${user.username}` : "/";
  const displayName =
    user.fullName || user.username || user.primaryEmailAddress?.emailAddress;

  return (
    <Link
      href={profileHref}
      className="rounded-full outline-none transition-transform duration-150 hover:opacity-80 active:scale-[0.96] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      aria-label="Your profile"
    >
      <UserAvatar
        seed={user.username || user.id}
        imageUrl={user.hasImage ? user.imageUrl : null}
        displayName={displayName}
      />
    </Link>
  );
}
