import { describe, it, expect } from "vitest";
import { pushSupport, vapidKeyToBytes, type PushEnvironment } from "../support";

const capable: PushEnvironment = {
  hasServiceWorker: true,
  hasPushManager: true,
  hasNotification: true,
  isIOS: false,
  isStandalone: false,
  permission: "default",
};

describe("pushSupport", () => {
  it("is available where the APIs exist", () => {
    expect(pushSupport(capable)).toBe("available");
    expect(pushSupport({ ...capable, isIOS: true, isStandalone: true })).toBe("available");
  });

  it("asks iPhone users in a Safari tab to install first", () => {
    expect(
      pushSupport({ ...capable, hasPushManager: false, hasNotification: false, isIOS: true })
    ).toBe("needs-install");
  });

  it("is unsupported when the APIs are missing even once installed", () => {
    expect(
      pushSupport({ ...capable, hasPushManager: false, isIOS: true, isStandalone: true })
    ).toBe("unsupported");
    expect(pushSupport({ ...capable, hasServiceWorker: false })).toBe("unsupported");
  });

  it("reports a blocked permission", () => {
    expect(pushSupport({ ...capable, permission: "denied" })).toBe("denied");
  });
});

describe("vapidKeyToBytes", () => {
  it("decodes unpadded base64url", () => {
    // "+/8=" in base64 is bytes fb ff; base64url drops padding and swaps chars.
    expect(Array.from(vapidKeyToBytes("-_8"))).toEqual([0xfb, 0xff]);
  });
});
