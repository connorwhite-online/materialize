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
  // Hide the org switcher chip entirely when the viewer has no org
  // memberships AND can't create one — Clerk renders an empty/
  // distracting "Personal account" pill otherwise. `userMemberships`
  // is populated lazily; treat undefined as "still loading".
  const { userMemberships, createOrganization } = useOrganizationList({
    userMemberships: { infinite: false },
  });
  const hasOrgs = (userMemberships?.data?.length ?? 0) > 0;
  const canCreateOrg = !!createOrganization;
  const showSwitcher = hasOrgs || canCreateOrg;

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
        {showSwitcher && (
          // Clerk's switcher handles "create org", "switch org",
          // and the org settings link. We point its "afterSelect"
          // callbacks at our routes so the slug shows up in the URL
          // instead of bouncing through Clerk's hosted pages.
          <OrganizationSwitcher
            hidePersonal={false}
            afterCreateOrganizationUrl={(org) => `/o/${org.slug}`}
            afterSelectOrganizationUrl={(org) => `/o/${org.slug}`}
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
