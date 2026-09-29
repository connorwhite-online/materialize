/**
 * Where this browser stands on Web Push, decided from plain facts so it
 * can be unit-tested without a browser.
 *
 * iOS is the case that shapes this: Safari only exposes PushManager to a
 * site that was added to the Home Screen and opened from there (iOS
 * 16.4+). In a regular Safari tab push simply doesn't exist, so the
 * honest thing to show is how to install, not a dead toggle.
 */
export type PushSupport =
  | "available"
  | "denied"
  | "needs-install"
  | "unsupported";

export interface PushEnvironment {
  hasServiceWorker: boolean;
  hasPushManager: boolean;
  hasNotification: boolean;
  isIOS: boolean;
  isStandalone: boolean;
  permission: NotificationPermission | null;
}

export function pushSupport(env: PushEnvironment): PushSupport {
  const capable =
    env.hasServiceWorker && env.hasPushManager && env.hasNotification;
  if (!capable) {
    return env.isIOS && !env.isStandalone ? "needs-install" : "unsupported";
  }
  if (env.permission === "denied") return "denied";
  return "available";
}

export function readPushEnvironment(): PushEnvironment {
  const nav = navigator as Navigator & { standalone?: boolean };
  // iPadOS reports itself as a Mac; touch points give it away.
  const isIOS =
    /iPad|iPhone|iPod/.test(nav.userAgent) ||
    (nav.platform === "MacIntel" && nav.maxTouchPoints > 1);
  return {
    hasServiceWorker: "serviceWorker" in nav,
    hasPushManager: "PushManager" in window,
    hasNotification: "Notification" in window,
    isIOS,
    isStandalone:
      window.matchMedia?.("(display-mode: standalone)").matches === true ||
      nav.standalone === true,
    permission: "Notification" in window ? Notification.permission : null,
  };
}

/** VAPID public key (base64url) → the BufferSource subscribe() wants. */
export function vapidKeyToBytes(base64Url: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = (base64Url + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}
