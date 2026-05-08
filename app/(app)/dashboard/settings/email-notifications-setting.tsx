"use client";

import { useState, useTransition } from "react";
import { Switch } from "@/components/ui/switch";
import {
  updateEmailNotificationsEnabled,
  updateEmailNotificationPref,
} from "@/app/actions/profile";
import type { EmailPrefMap } from "@/lib/notifications/email-prefs";

const EVENT_TYPES: Array<{
  key: keyof EmailPrefMap;
  label: string;
  description: string;
}> = [
  {
    key: "comment_on_listing",
    label: "Comments on your listings",
    description:
      "When someone leaves a top-level comment on one of your files or projects.",
  },
  {
    key: "reply_to_comment",
    label: "Replies to your comments",
    description: "When someone replies to a comment you posted.",
  },
  {
    key: "make_on_file",
    label: "Makes on your files",
    description:
      "When someone shares a community-printed photo (make) of one of your files.",
  },
  {
    key: "print_on_file",
    label: "Prints of your files",
    description:
      "When someone places a print order containing one of your files.",
  },
];

interface Props {
  /** Master switch — controls all email regardless of per-type prefs. */
  initial: boolean;
  /** Per-type opt-out map. Null/missing keys default to ON. */
  initialPrefs: EmailPrefMap | null;
}

export function EmailNotificationsSetting({ initial, initialPrefs }: Props) {
  const [master, setMaster] = useState(initial);
  const [prefs, setPrefs] = useState<EmailPrefMap>(initialPrefs ?? {});
  const [, startTransition] = useTransition();

  const handleMaster = (next: boolean) => {
    const previous = master;
    setMaster(next);
    startTransition(async () => {
      const result = await updateEmailNotificationsEnabled(next);
      if ("error" in result) setMaster(previous);
    });
  };

  const handleType = (key: keyof EmailPrefMap, next: boolean) => {
    const previous = prefs[key] !== false;
    setPrefs((p) => ({ ...p, [key]: next }));
    startTransition(async () => {
      const result = await updateEmailNotificationPref(key, next);
      if ("error" in result) {
        setPrefs((p) => ({ ...p, [key]: previous }));
      }
    });
  };

  return (
    <div className="border-t border-border pt-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <div className="text-sm font-medium">Email notifications</div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Master switch for all transactional notification emails. The bell
            on the nav stays active either way.
          </p>
        </div>
        <Switch checked={master} onCheckedChange={handleMaster} />
      </div>

      {master && (
        <div className="mt-4 space-y-3 rounded-xl border border-border bg-muted/20 p-4">
          {EVENT_TYPES.map(({ key, label, description }) => {
            const enabled = prefs[key] !== false;
            return (
              <div
                key={key}
                className="flex items-start justify-between gap-4"
              >
                <div className="flex-1">
                  <div className="text-sm">{label}</div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {description}
                  </p>
                </div>
                <Switch
                  checked={enabled}
                  onCheckedChange={(v) => handleType(key, v)}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
