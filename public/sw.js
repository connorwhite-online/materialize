// Materialize service worker — Web Push only.
//
// Deliberately does nothing else: no fetch handler, no offline cache.
// A caching service worker is a separate decision with its own ways to
// serve stale pages; this one exists so a push can reach a locked phone.
//
// Payload shape is PushMessage in lib/push/message.ts:
//   { title, body, url, tag? } — url is a same-origin path.

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : null };
  }

  // Safari revokes push for a site that receives a push without
  // showing a notification, so always show one, even for an odd payload.
  const title = data.title || "Materialize";
  const options = {
    body: data.body || undefined,
    icon: "/apple-icon.png",
    data: { url: data.url || "/" },
  };
  if (data.tag) {
    options.tag = data.tag;
    options.renotify = true;
  }
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  // Resolve against our own origin and refuse anything that leaves it.
  let target = new URL("/", self.location.origin);
  try {
    const candidate = new URL(
      (event.notification.data && event.notification.data.url) || "/",
      self.location.origin
    );
    if (candidate.origin === self.location.origin) target = candidate;
  } catch {
    // keep "/"
  }

  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      for (const client of windows) {
        if (new URL(client.url).origin !== self.location.origin) continue;
        try {
          await client.focus();
          // navigate() rejects for a window this worker doesn't control.
          await client.navigate(target.href);
          return;
        } catch {
          break;
        }
      }
      await self.clients.openWindow(target.href);
    })()
  );
});
