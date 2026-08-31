"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { SegmentedControl } from "@/components/ui/segmented-control";
import {
  OWNER_SETTINGS_TAB_ALIASES,
  ownerSettingsHref,
  type OwnerSettingsTab,
} from "@/lib/profile/owner-settings-tabs";

const TABS: Array<{ value: OwnerSettingsTab; label: string }> = [
  { value: "settings", label: "Settings" },
  { value: "agents", label: "Agents" },
  { value: "payments", label: "Payments" },
];

interface OwnerSettingsTabsProps {
  username: string;
  activeTab: OwnerSettingsTab;
}

/**
 * Owner profile Settings / Agents / Payments strip. Chrome comes from the
 * shared `SegmentedControl` (same pill track as project page tabs); this
 * wrapper only owns URL sync + legacy `?tab=` alias cleanup.
 */
export function OwnerSettingsTabs({
  username,
  activeTab,
}: OwnerSettingsTabsProps) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [localTab, setLocalTab] = useState<OwnerSettingsTab>(activeTab);

  useEffect(() => {
    setLocalTab(activeTab);
  }, [activeTab]);

  // Soft-clean legacy ?tab=general / ?tab=notifications onto Settings
  // without a server redirect (those flash a Next error boundary on
  // client navigations).
  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    const tab = url.searchParams.get("tab");
    if (!tab || !(tab in OWNER_SETTINGS_TAB_ALIASES)) return;
    url.searchParams.delete("tab");
    const next =
      url.pathname +
      (url.searchParams.toString() ? `?${url.searchParams}` : "");
    window.history.replaceState(null, "", next);
  }, []);

  return (
    <SegmentedControl
      value={localTab}
      onValueChange={(tab) => {
        if (tab === localTab) return;
        setLocalTab(tab);
        startTransition(() => {
          router.push(ownerSettingsHref(username, tab), { scroll: false });
        });
      }}
      items={TABS}
    />
  );
}
