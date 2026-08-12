"use client";

import { UserAvatar } from "./user-avatar";
import { useUnreadCount } from "@/lib/hooks/use-unread-count";
import { cn } from "@/lib/utils";

interface Props {
  /** Initial unread count from the server render. */
  initialUnreadCount: number;
  seed: string;
  imageUrl: string | null;
  displayName: string | null;
  className?: string;
}

/**
 * UserAvatar with a small unread-notification dot in the top-right.
 * Polling lives in `useUnreadCount` so the desktop bell can share it.
 */
export function AvatarWithUnreadDot({
  initialUnreadCount,
  seed,
  imageUrl,
  displayName,
  className,
}: Props) {
  const unreadCount = useUnreadCount(initialUnreadCount);

  return (
    <div className="relative shrink-0">
      <UserAvatar
        seed={seed}
        imageUrl={imageUrl}
        displayName={displayName}
        className={className}
      />
      {unreadCount > 0 && (
        <span
          aria-label={`${unreadCount} unread notification${
            unreadCount === 1 ? "" : "s"
          }`}
          className={cn(
            "absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-primary ring-2 ring-card"
          )}
        />
      )}
    </div>
  );
}
