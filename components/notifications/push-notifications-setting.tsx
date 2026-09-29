"use client";

import { useEffect, useState } from "react";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import {
  removePushSubscription,
  savePushSubscription,
  sendTestPush,
} from "@/app/actions/push";
import {
  pushSupport,
  readPushEnvironment,
  vapidKeyToBytes,
  type PushSupport,
} from "@/lib/push/support";

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";

/**
 * Per-device push toggle, beside the email prefs. Push is a property of
 * this phone or browser, not of the account, so the switch reflects
 * whether THIS device is subscribed.
 *
 * The service worker is registered on mount rather than on tap so the
 * tap handler can go straight to `Notification.requestPermission()`:
 * iOS only shows the prompt from a user gesture, and every await in
 * front of it spends some of that gesture.
 */
export function PushNotificationsSetting() {
  const [support, setSupport] = useState<PushSupport | null>(null);
  const [isIOS, setIsIOS] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    // No keys configured → push is off server-side; render nothing.
    if (!VAPID_PUBLIC_KEY) return;
    const env = readPushEnvironment();
    const state = pushSupport(env);
    let cancelled = false;
    (async () => {
      if (state !== "available") {
        if (!cancelled) {
          setIsIOS(env.isIOS);
          setSupport(state);
        }
        return;
      }
      try {
        const reg = await navigator.serviceWorker.register("/sw.js", {
          scope: "/",
          updateViaCache: "none",
        });
        const sub = await reg.pushManager.getSubscription();
        // Re-sync on every open: cheap, and it heals a row lost server-side
        // or a device that signed in as someone else.
        if (sub) void savePushSubscription(sub.toJSON(), navigator.userAgent);
        if (cancelled) return;
        setIsIOS(env.isIOS);
        setEnabled(Boolean(sub));
        setSupport(state);
      } catch {
        if (!cancelled) setSupport("unsupported");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!VAPID_PUBLIC_KEY || support === null) return null;

  const turnOn = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        if (permission === "denied") setSupport("denied");
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: vapidKeyToBytes(VAPID_PUBLIC_KEY),
        }));
      const result = await savePushSubscription(
        sub.toJSON(),
        navigator.userAgent
      );
      if ("error" in result) {
        await sub.unsubscribe();
        setMessage(result.error);
        return;
      }
      setEnabled(true);
    } catch {
      setMessage("Couldn't turn on notifications on this device.");
    } finally {
      setBusy(false);
    }
  };

  const turnOff = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await removePushSubscription(sub.endpoint);
        await sub.unsubscribe();
      }
      setEnabled(false);
    } catch {
      setMessage("Couldn't turn off notifications on this device.");
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    setBusy(true);
    setMessage(null);
    const result = await sendTestPush();
    setMessage("error" in result ? result.error : "Sent. It should arrive in a few seconds.");
    setBusy(false);
  };

  return (
    <div>
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="text-sm font-medium">Push notifications</div>
          <div className="text-xs text-muted-foreground">On this device</div>
        </div>
        {support === "available" && (
          <Switch
            checked={enabled}
            disabled={busy}
            onCheckedChange={(next) => void (next ? turnOn() : turnOff())}
          />
        )}
      </div>

      {support === "needs-install" && (
        <p className="mt-2 text-xs text-muted-foreground">
          To get notifications on iPhone, tap Share, then Add to Home Screen,
          and open Materialize from there.
        </p>
      )}
      {support === "denied" && (
        <p className="mt-2 text-xs text-muted-foreground">
          {isIOS
            ? "Notifications are blocked. Turn them on in Settings, Notifications, Materialize."
            : "Notifications are blocked for this site in your browser settings."}
        </p>
      )}
      {support === "unsupported" && (
        <p className="mt-2 text-xs text-muted-foreground">
          This browser doesn&apos;t support push notifications.
        </p>
      )}

      {support === "available" && enabled && (
        <Button
          variant="ghost"
          size="xs"
          className="mt-2 -ml-2.5"
          disabled={busy}
          onClick={() => void test()}
        >
          Send a test notification
        </Button>
      )}

      {message && (
        <p className="mt-2 text-xs text-muted-foreground" role="status">
          {message}
        </p>
      )}
    </div>
  );
}
