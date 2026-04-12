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
 * User avatar with gradient fallback and subtle inner shadow.
 * Shows uploaded image if available, otherwise a deterministic gradient
 * based on the user's seed (id/username) with their initial.
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
    <div className={cn("relative inline-block", className)}>
      <Avatar className="h-full w-full">
        {imageUrl && <AvatarImage src={imageUrl} alt={displayName || ""} />}
        <AvatarFallback
          className="text-foreground/70 font-medium"
          style={{ background: gradient }}
        >
          {initial}
        </AvatarFallback>
      </Avatar>
      {/* Inner shadow overlay — sits on top of image/gradient */}
      <div
        className="pointer-events-none absolute inset-0 rounded-full"
        style={{
          boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.06), inset 0 2px 4px rgba(0,0,0,0.08), inset 0 -1px 2px rgba(255,255,255,0.15)",
        }}
      />
    </div>
  );
}
