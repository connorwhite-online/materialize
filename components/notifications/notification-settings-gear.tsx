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
 * Quiet gear (ghost icon button) opposite the Notifications headline. Opens a sheet with
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
          "inline-flex shrink-0 cursor-pointer items-center justify-center rounded-full text-muted-foreground transition-[transform,background-color,color] duration-150 hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none active:scale-[0.96]",
          compact ? "size-8" : "size-9",
          className
        )}
      >
        <Gear size={compact ? 16 : 18} />
      </button>

      <NativeSheet
        open={open}
        onClose={() => setOpen(false)}
        ariaLabel="Notification settings"
      >
        <div className="flex flex-col gap-3 px-5 pt-1 pb-2">
          <h2 className="text-lg leading-6 font-semibold">
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
