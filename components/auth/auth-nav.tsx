"use client";

import { useUser } from "@clerk/nextjs";
import { Button } from "@/components/ui/button";
import { UserMenu } from "./user-menu";
import { useAuthModal } from "./auth-modal";
import { CartButton } from "@/components/print/cart-button";

export function AuthNav() {
  const { isLoaded, isSignedIn } = useUser();
  const { openAuth } = useAuthModal();

  if (!isLoaded) {
    return <div className="h-8 w-8" />;
  }

  if (isSignedIn) {
    return (
      <div className="flex items-center gap-2">
        <CartButton />
        <UserMenu />
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
