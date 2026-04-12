"use client";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { getAvatarGradient } from "@/lib/utils/avatar-gradient";
import { cn } from "@/lib/utils";

interface UserAvatarProps {
  seed: string;
  imageUrl?: string | null;
  displayName?: string | null;
  className?: string;
}

/**
 * User avatar with gradient fallback and inner shadow for depth.
 */
export function UserAvatar({
  seed,
  imageUrl,
  displayName,
  className,
}: UserAvatarProps) {
  const gradient = getAvatarGradient(seed);

  return (
    <div className={cn("relative inline-block h-8 w-8", className)}>
      <Avatar className="h-full w-full">
        {imageUrl && <AvatarImage src={imageUrl} alt={displayName || ""} />}
        <AvatarFallback
          className="h-full w-full"
          style={{ background: gradient }}
        />
      </Avatar>
      {/* Inner shadow overlay — sits above the avatar content.
          Uses only blurred shadows (no spread) so edges read as a soft
          vignette rather than a hard stroke. */}
      <div
        className="pointer-events-none absolute inset-0 rounded-full"
        style={{
          boxShadow:
            "inset 0 3px 6px rgba(0,0,0,0.22), inset 0 -2px 5px rgba(255,255,255,0.22), inset 0 0 8px rgba(0,0,0,0.10)",
        }}
      />
    </div>
  );
}
