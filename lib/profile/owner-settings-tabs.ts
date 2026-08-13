export const OWNER_SETTINGS_TABS = [
  "general",
  "notifications",
  "agents",
  "payments",
] as const;

export type OwnerSettingsTab = (typeof OWNER_SETTINGS_TABS)[number];

export function isOwnerSettingsTab(value: string): value is OwnerSettingsTab {
  return (OWNER_SETTINGS_TABS as readonly string[]).includes(value);
}

export function ownerSettingsHref(
  username: string,
  tab: OwnerSettingsTab
): string {
  return tab === "general" ? `/${username}` : `/${username}?tab=${tab}`;
}
