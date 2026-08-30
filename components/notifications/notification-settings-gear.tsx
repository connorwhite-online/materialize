"use client";

import { useEffect, useState, useTransition } from "react";
import { Gear } from "@/components/icons/gear";
import { NativeSheet } from "@/components/ui/native-sheet";
import { EmailNotificationsSetting } from "@/app/(app)/dashboard/settings/email-notifications-setting";
import { getMyEmailNotificationPrefs } from "@/app/actions/profile";
import type { EmailPrefMap } from "@/lib/notifications/email-prefs";
import { cn } from "@/lib/utils";

type Prefs = {
  enabled: boolean;
  prefs: EmailPrefMap | null;
};

interface NotificationSettingsGearProps {
  /** Optional server-loaded prefs; when omitted we fetch on first open. */
  initialEnabled?: boolean;
  initialPrefs?: EmailPrefMap | null;
  /** Slightly smaller tile for the popover header. */
  compact?: boolean;
  className?: string;
}

/**
 * Chunky gear opposite the Notifications headline. Opens a sheet with
 * email notification prefs — shared by `/notifications` and the
 * desktop bell popover.
 */
export function NotificationSettingsGear({
  initialEnabled,
  initialPrefs,
  compact = false,
  className,
}: NotificationSettingsGearProps) {
  const [open, setOpen] = useState(false);
  const [prefs, setPrefs] = useState<Prefs | null>(() =>
    initialEnabled === undefined
      ? null
      : { enabled: initialEnabled, prefs: initialPrefs ?? null }
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, startLoad] = useTransition();

  useEffect(() => {
    if (!open || prefs) return;
    startLoad(async () => {
      const result = await getMyEmailNotificationPrefs();
      if ("error" in result) {
        setError(result.error);
        return;
      }
      setPrefs({ enabled: result.enabled, prefs: result.prefs });
    });
  }, [open, prefs]);

  return (
    <>
      <button
        type="button"
        aria-label="Notification settings"
        title="Notification settings"
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
        className={cn(
          "inline-flex shrink-0 cursor-pointer items-center justify-center rounded-[14px] bg-muted text-foreground shadow-[0_1px_0_rgba(0,0,0,0.04)] ring-1 ring-border/70 transition-[transform,background-color,box-shadow] hover:bg-muted/80 hover:ring-border active:scale-[0.96]",
          compact ? "h-9 w-9" : "h-11 w-11",
          className
        )}
      >
        <Gear size={compact ? 17 : 19} />
      </button>

      <NativeSheet
        open={open}
        onClose={() => setOpen(false)}
        ariaLabel="Notification settings"
      >
        <div className="space-y-4 px-5 pb-2 pt-1">
          <h2 className="text-lg font-semibold tracking-tight">
            Notification settings
          </h2>

          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}

          {!prefs && !error && (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {pending ? "Loading…" : "Preparing…"}
            </p>
          )}

          {prefs && (
            <EmailNotificationsSetting
              initial={prefs.enabled}
              initialPrefs={prefs.prefs}
            />
          )}
        </div>
      </NativeSheet>
    </>
  );
}
