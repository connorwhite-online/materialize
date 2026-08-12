"use client";

import { OrganizationSwitcher, useOrganizationList, useUser } from "@clerk/nextjs";
import { usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";
import { UserMenu } from "./user-menu";
import { useAuthModal } from "./auth-modal";
import { CartButton } from "@/components/print/cart-button";

export function AuthNav() {
  const { user, isLoaded, isSignedIn } = useUser();
  const { openAuth } = useAuthModal();
  const pathname = usePathname();
  // Only render Clerk's <OrganizationSwitcher /> once the viewer is
  // actually a member of at least one org. Without this guard Clerk
  // falls back to a "Personal account" pill that looks nothing like
  // the rest of the chrome (default purple avatar, distinct
  // typography) and is pure noise for the common case where someone
  // hasn't created a team yet. Users who want to create their first
  // org go through /o/new, which renders Clerk's hosted
  // <CreateOrganization /> on its own.
  const { userMemberships } = useOrganizationList({
    userMemberships: { infinite: false },
  });
  const hasOrgs = (userMemberships?.data?.length ?? 0) > 0;

  if (!isLoaded) {
    return <div className="h-8 w-8" />;
  }

  if (isSignedIn) {
    // Hide the avatar when the user is already on their own profile —
    // the avatar would just link to the page they're looking at. The
    // user lands here every time `/` redirects an authed visitor to
    // /u/<their-username>, so this is the common case.
    const onOwnProfile =
      !!user?.username && pathname === `/${user.username}`;
    return (
      <div className="flex items-center gap-2">
        {hasOrgs && (
          // Clerk's switcher handles "switch org" and the org settings
          // link. We point afterSelect at our routes so the slug shows
          // up in the URL instead of bouncing through Clerk's hosted
          // pages. Creating a NEW org happens through /o/new, not
          // through the switcher's create-modal — keeps the trigger
          // chip lean once someone is in team mode.
          <OrganizationSwitcher
            hidePersonal={false}
            afterCreateOrganizationUrl={(org) => `/${org.slug}`}
            afterSelectOrganizationUrl={(org) => `/${org.slug}`}
            createOrganizationMode="modal"
            organizationProfileMode="modal"
            appearance={{
              elements: {
                organizationSwitcherTrigger: "h-8 px-2 rounded-full",
              },
            }}
          />
        )}
        <CartButton />
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
