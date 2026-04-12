"use client";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { getAvatarGradient } from "@/lib/utils/avatar-gradient";
import { cn } from "@/lib/utils";

interface UserAvatarProps {
  seed: string; // user id or username for deterministic gradient
  imageUrl?: string | null;
  displayName?: string | null;
  className?: string;
}

/**
 * User avatar with gradient fallback.
 * Shows uploaded image if available, otherwise shows a deterministic
 * gradient based on the user's seed (id/username) with their initial.
 */
export function UserAvatar({
  seed,
  imageUrl,
  displayName,
  className,
}: UserAvatarProps) {
  const initial = (displayName?.[0] || seed[0] || "?").toUpperCase();
  const gradient = getAvatarGradient(seed);

  return (
    <Avatar className={cn("h-8 w-8", className)}>
      {imageUrl && <AvatarImage src={imageUrl} alt={displayName || ""} />}
      <AvatarFallback
        className="text-foreground/70 font-medium"
        style={{ background: gradient }}
      >
        {initial}
      </AvatarFallback>
    </Avatar>
  );
}
