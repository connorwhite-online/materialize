/**
 * Push endpoints come from the browser, so they're client-supplied URLs
 * the server will later POST to. Only accept the real push services;
 * anything else would turn every notification into a request to an
 * address of the caller's choosing.
 */
const PUSH_SERVICE_HOSTS = [
  "push.apple.com", // Safari, including iOS Home Screen apps
  "fcm.googleapis.com", // Chrome, Edge on Android, most Chromium
  "android.googleapis.com",
  "push.services.mozilla.com", // Firefox
  "notify.windows.com", // Edge on Windows
];

export function isAllowedPushEndpoint(endpoint: string): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.port !== "" || url.username || url.password) {
    return false;
  }
  const host = url.hostname.toLowerCase();
  return PUSH_SERVICE_HOSTS.some(
    (allowed) => host === allowed || host.endsWith(`.${allowed}`)
  );
}
