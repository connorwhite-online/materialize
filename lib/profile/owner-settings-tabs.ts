export const OWNER_SETTINGS_TABS = [
  "settings",
  "agents",
  "payments",
] as const;

export type OwnerSettingsTab = (typeof OWNER_SETTINGS_TABS)[number];

/** Old query values that should resolve to the Settings tab. */
export const OWNER_SETTINGS_TAB_ALIASES: Record<string, OwnerSettingsTab> = {
  general: "settings",
  notifications: "settings",
};

export function isOwnerSettingsTab(value: string): value is OwnerSettingsTab {
  return (OWNER_SETTINGS_TABS as readonly string[]).includes(value);
}

export function resolveOwnerSettingsTab(
  value: string | undefined
): OwnerSettingsTab {
  if (!value) return "settings";
  if (isOwnerSettingsTab(value)) return value;
  return OWNER_SETTINGS_TAB_ALIASES[value] ?? "settings";
}

export function ownerSettingsHref(
  username: string,
  tab: OwnerSettingsTab
): string {
  return tab === "settings" ? `/${username}` : `/${username}?tab=${tab}`;
}
