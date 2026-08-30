import { describe, expect, it } from "vitest";
import {
  OWNER_SETTINGS_TABS,
  isOwnerSettingsTab,
  ownerSettingsHref,
  resolveOwnerSettingsTab,
} from "@/lib/profile/owner-settings-tabs";

describe("owner-settings-tabs", () => {
  it("exposes Settings / Agents / Payments only", () => {
    expect([...OWNER_SETTINGS_TABS]).toEqual([
      "settings",
      "agents",
      "payments",
    ]);
  });

  it("omits the query string for the Settings tab", () => {
    expect(ownerSettingsHref("ada", "settings")).toBe("/ada");
    expect(ownerSettingsHref("ada", "payments")).toBe("/ada?tab=payments");
  });

  it("aliases legacy General and Notifications onto Settings", () => {
    expect(resolveOwnerSettingsTab(undefined)).toBe("settings");
    expect(resolveOwnerSettingsTab("settings")).toBe("settings");
    expect(resolveOwnerSettingsTab("general")).toBe("settings");
    expect(resolveOwnerSettingsTab("notifications")).toBe("settings");
    expect(resolveOwnerSettingsTab("payments")).toBe("payments");
    expect(isOwnerSettingsTab("notifications")).toBe(false);
    expect(isOwnerSettingsTab("general")).toBe(false);
  });
});
