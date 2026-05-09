"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { markAllNotificationsRead } from "@/app/actions/notifications";

/**
 * "Mark all read" trigger for the notifications tab. Server action
 * runs in a transition; router.refresh() re-runs the tab's data
 * fetch so the now-read rows lose their unread treatment.
 */
export function NotificationsTabActions() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <Button
      variant="ghost"
      size="xs"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          await markAllNotificationsRead();
          router.refresh();
        })
      }
    >
      {pending ? "Marking…" : "Mark all read"}
    </Button>
  );
}
