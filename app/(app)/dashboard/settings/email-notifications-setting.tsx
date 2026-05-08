"use client";

import { useState, useTransition } from "react";
import { Switch } from "@/components/ui/switch";
import { updateEmailNotificationsEnabled } from "@/app/actions/profile";

export function EmailNotificationsSetting({
  initial,
}: {
  initial: boolean;
}) {
  const [value, setValue] = useState(initial);
  const [pending, startTransition] = useTransition();

  const handleChange = (next: boolean) => {
    const previous = value;
    setValue(next);
    startTransition(async () => {
      const result = await updateEmailNotificationsEnabled(next);
      if ("error" in result) {
        // Revert optimistic state on failure so the toggle reflects
        // the actual server-side value.
        setValue(previous);
      }
    });
  };

  return (
    <div className="border-t border-border pt-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <div className="text-sm font-medium">Email notifications</div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            When on, we&apos;ll email you when someone comments on your
            listings, replies to your comments, or shares a make of your
            file. The bell on the nav stays active either way.
          </p>
        </div>
        <Switch
          checked={value}
          onCheckedChange={handleChange}
          disabled={pending}
        />
      </div>
    </div>
  );
}
