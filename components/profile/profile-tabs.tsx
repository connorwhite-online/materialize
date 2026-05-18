"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { motion } from "motion/react";
import { cn } from "@/lib/utils";

type Tab = "library" | "orders" | "earnings" | "notifications";

interface ProfileTabsProps {
  username: string;
  activeTab: Tab;
  isOwner: boolean;
  /** Unread count drives the dot indicator on the Notifications tab. */
  unreadNotifications?: number;
}

export function ProfileTabs({
  username,
  activeTab,
  isOwner,
  unreadNotifications = 0,
}: ProfileTabsProps) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  // Local state for instant UI updates; URL syncs in the background
  const [localTab, setLocalTab] = useState<Tab>(activeTab);

  const tabs: Array<{
    key: Tab;
    label: string;
    ownerOnly?: boolean;
    showDot?: boolean;
  }> = [
    { key: "library", label: "Library" },
    { key: "orders", label: "Orders", ownerOnly: true },
    {
      key: "notifications",
      label: "Notifications",
      ownerOnly: true,
      showDot: unreadNotifications > 0,
    },
    { key: "earnings", label: "Earnings", ownerOnly: true },
  ];

  const visibleTabs = tabs.filter((t) => !t.ownerOnly || isOwner);

  const handleClick = (tab: Tab) => {
    if (tab === localTab) return;
    // Update UI immediately
    setLocalTab(tab);
    // Navigate in a transition so the page content updates without
    // blocking the underline animation
    const href =
      tab === "library" ? `/${username}` : `/${username}?tab=${tab}`;
    startTransition(() => {
      router.push(href, { scroll: false });
    });
  };

  return (
    <div className="border-b border-border">
      <nav className="flex gap-1 -mb-px">
        {visibleTabs.map((tab) => {
          const active = localTab === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => handleClick(tab.key)}
              className={cn(
                "relative px-4 py-2.5 text-sm font-medium cursor-pointer transition-colors",
                active
                  ? "text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <span className="inline-flex items-center gap-1.5">
                {tab.label}
                {tab.showDot && (
                  <span
                    aria-label="Unread"
                    className="size-1.5 rounded-full bg-primary"
                  />
                )}
              </span>
              {active && (
                <motion.div
                  layoutId="profile-tab-underline"
                  className="absolute left-0 right-0 bottom-0 h-0.5 bg-foreground"
                  transition={{
                    duration: 0.22,
                    ease: [0.2, 0.8, 0.2, 1],
                  }}
                />
              )}
            </button>
          );
        })}
      </nav>
    </div>
  );
}
