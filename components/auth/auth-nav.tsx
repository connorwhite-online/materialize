"use client";

import { useUser } from "@clerk/nextjs";
import { usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";
import { UserMenu } from "./user-menu";
import { useAuthModal } from "./auth-modal";
import { CartButton } from "@/components/print/cart-button";

interface Props {
  /**
   * Server-rendered notification bell slot. Only meaningful for
   * authed users; anon viewers ignore it. Threaded as a slot so the
   * server-side data fetch (auth + DB query) can happen outside this
   * client component.
   */
  notificationsSlot?: React.ReactNode;
}

export function AuthNav({ notificationsSlot }: Props = {}) {
  const { user, isLoaded, isSignedIn } = useUser();
  const { openAuth } = useAuthModal();
  const pathname = usePathname();

  if (!isLoaded) {
    return <div className="h-8 w-8" />;
  }

  if (isSignedIn) {
    // Hide the avatar when the user is already on their own profile —
    // the avatar would just link to the page they're looking at, and
    // sidebar mode (>=1700) puts a Profile entry in the rail. The
    // user lands here every time `/` redirects an authed visitor to
    // /u/<their-username>, so this is the common case.
    const onOwnProfile =
      !!user?.username && pathname === `/u/${user.username}`;
    return (
      <div className="flex items-center gap-2">
        <CartButton />
        {notificationsSlot}
        {!onOwnProfile && <UserMenu />}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <CartButton />
      <Button size="sm" onClick={() => openAuth("sign-in")}>
        Sign in
      </Button>
    </div>
  );
}
