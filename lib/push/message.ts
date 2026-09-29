import {
  notificationHeadline,
  notificationSnippet,
  type NotificationContentPayload,
} from "@/lib/notifications/copy";
import {
  buildHref,
  type NotificationPayload,
} from "@/lib/notifications/inbox";
import type { NotificationType } from "@/lib/notifications/types";

/**
 * What `public/sw.js` reads out of a push. `url` is a same-origin PATH,
 * never an absolute URL: the service worker resolves it against its own
 * origin, so nothing here depends on NEXT_PUBLIC_APP_URL (which bakes at
 * build time) and a payload can't send a tap off-site.
 */
export interface PushMessage {
  title: string;
  body: string | null;
  url: string;
  /** Same tag replaces the earlier notification instead of stacking. */
  tag?: string;
}

// Push services cap the encrypted payload at ~4KB; a body is a preview.
const MAX_BODY = 180;

function clip(text: string | null): string | null {
  if (!text) return null;
  return text.length <= MAX_BODY ? text : text.slice(0, MAX_BODY - 1) + "…";
}

/** A push mirroring an inbox notification: email's words, the inbox's link. */
export function pushForNotification(
  type: NotificationType,
  payload: NotificationContentPayload
): PushMessage {
  return {
    title: notificationHeadline(type, payload),
    body: clip(notificationSnippet(type, payload)),
    url: buildHref({
      id: "",
      type,
      payload: payload as NotificationPayload,
      readAt: null,
      createdAt: new Date(0),
    }),
  };
}

const ORDER_STATUS_COPY: Partial<Record<string, { title: string; body: string }>> = {
  in_production: {
    title: "Your print is in production",
    body: "The manufacturer has started on your order.",
  },
  shipped: {
    title: "Your print has shipped",
    body: "It's on its way to you.",
  },
  received: {
    title: "Your print was delivered",
    body: "Enjoy it, and share a photo on the file page if you like.",
  },
  blocked: {
    title: "Your print order is on hold",
    body: "The manufacturer paused it. Open the order for details.",
  },
  cancelled: {
    title: "Your print order was cancelled",
    body: "The manufacturer cancelled it. Open the order for details.",
  },
};

/**
 * A buyer-facing push for a fulfillment status change, or null for a
 * status the buyer doesn't need pinging about. Tagged per order so a
 * later status replaces the earlier one on the lock screen.
 */
export function pushForOrderStatus(
  orderId: string,
  status: string
): PushMessage | null {
  const copy = ORDER_STATUS_COPY[status];
  if (!copy) return null;
  return {
    title: copy.title,
    body: copy.body,
    url: `/dashboard/orders/${orderId}`,
    tag: `order-${orderId}`,
  };
}
