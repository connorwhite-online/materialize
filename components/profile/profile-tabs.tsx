"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { motion } from "motion/react";
import { cn } from "@/lib/utils";

type Tab = "library" | "orders" | "earnings";

interface ProfileTabsProps {
  username: string;
  activeTab: Tab;
  isOwner: boolean;
}

export function ProfileTabs({ username, activeTab, isOwner }: ProfileTabsProps) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  // Local state for instant UI updates; URL syncs in the background
  const [localTab, setLocalTab] = useState<Tab>(activeTab);

  const tabs: Array<{ key: Tab; label: string; ownerOnly?: boolean }> = [
    { key: "library", label: "Library" },
    { key: "orders", label: "Orders", ownerOnly: true },
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
      tab === "library" ? `/u/${username}` : `/u/${username}?tab=${tab}`;
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
              {tab.label}
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
