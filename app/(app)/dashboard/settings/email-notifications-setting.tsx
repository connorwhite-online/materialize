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
}> = [
  { key: "comment_on_listing", label: "Comments on your listings" },
  { key: "reply_to_comment", label: "Replies to your comments" },
  { key: "build_on_file", label: "Builds of your files" },
  { key: "print_on_file", label: "Prints of your files" },
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
    <div>
      <div className="flex items-center justify-between gap-4">
        <div className="text-sm font-medium">Email notifications</div>
        <Switch checked={master} onCheckedChange={handleMaster} />
      </div>

      {master && (
        <div className="mt-4 space-y-1 rounded-xl border border-border bg-muted/50 p-2">
          {EVENT_TYPES.map(({ key, label }) => {
            const enabled = prefs[key] !== false;
            return (
              <div
                key={key}
                className="flex items-center justify-between gap-4 rounded-lg px-2 py-2.5"
              >
                <div className="text-sm">{label}</div>
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
