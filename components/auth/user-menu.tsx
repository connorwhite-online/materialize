"use client";

import { useUser, useClerk } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

export function UserMenu() {
  const { user, isLoaded } = useUser();
  const { signOut } = useClerk();
  const router = useRouter();

  if (!isLoaded || !user) return null;

  const displayName =
    user.fullName || user.username || user.primaryEmailAddress?.emailAddress;
  const email = user.primaryEmailAddress?.emailAddress;
  const initials =
    user.firstName?.[0] ||
    user.username?.[0] ||
    email?.[0] ||
    "?";

  const handleSignOut = async () => {
    await signOut();
    router.push("/");
    router.refresh();
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="User menu"
        className="rounded-full outline-none transition-opacity hover:opacity-80"
      >
        <Avatar className="h-8 w-8">
          <AvatarImage src={user.imageUrl} alt={displayName || ""} />
          <AvatarFallback>{initials.toUpperCase()}</AvatarFallback>
        </Avatar>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <div className="px-2 py-1.5">
          <p className="text-sm font-medium truncate">{displayName}</p>
          {email && email !== displayName && (
            <p className="text-xs text-muted-foreground truncate mt-0.5">
              {email}
            </p>
          )}
        </div>
        <DropdownMenuSeparator />
        {user.username && (
          <DropdownMenuItem onClick={() => router.push(`/u/${user.username}`)}>
            View profile
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onClick={() => router.push("/dashboard")}>
          Dashboard
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => router.push("/dashboard/settings")}>
          Settings
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={handleSignOut}>Sign out</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
