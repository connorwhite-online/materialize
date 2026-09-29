import { describe, it, expect } from "vitest";
import { isAllowedPushEndpoint } from "../endpoint";

describe("isAllowedPushEndpoint", () => {
  it("accepts the real push services", () => {
    expect(isAllowedPushEndpoint("https://web.push.apple.com/QGx1abc")).toBe(true);
    expect(isAllowedPushEndpoint("https://fcm.googleapis.com/fcm/send/abc")).toBe(true);
    expect(isAllowedPushEndpoint("https://updates.push.services.mozilla.com/wpush/v2/x")).toBe(true);
    expect(isAllowedPushEndpoint("https://wns2-by3p.notify.windows.com/w/?token=x")).toBe(true);
  });

  it("rejects anything else the browser could be made to send", () => {
    expect(isAllowedPushEndpoint("http://web.push.apple.com/x")).toBe(false);
    expect(isAllowedPushEndpoint("https://evil.example/push.apple.com")).toBe(false);
    expect(isAllowedPushEndpoint("https://push.apple.com.evil.example/x")).toBe(false);
    expect(isAllowedPushEndpoint("https://evilpush.apple.com.example/x")).toBe(false);
    expect(isAllowedPushEndpoint("https://web.push.apple.com:8443/x")).toBe(false);
    expect(isAllowedPushEndpoint("https://u:p@web.push.apple.com/x")).toBe(false);
    expect(isAllowedPushEndpoint("https://169.254.169.254/latest")).toBe(false);
    expect(isAllowedPushEndpoint("not a url")).toBe(false);
  });
});
