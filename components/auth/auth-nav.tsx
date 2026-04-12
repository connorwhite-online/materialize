"use client";

import { useUser } from "@clerk/nextjs";
import { Button } from "@/components/ui/button";
import { UserMenu } from "./user-menu";
import { useAuthModal } from "./auth-modal";

export function AuthNav() {
  const { isLoaded, isSignedIn } = useUser();
  const { openAuth } = useAuthModal();

  if (!isLoaded) {
    return <div className="h-8 w-8" />; // reserve space while loading
  }

  if (isSignedIn) {
    return <UserMenu />;
  }

  return (
    <Button size="sm" onClick={() => openAuth("sign-in")}>
      Sign in
    </Button>
  );
}
