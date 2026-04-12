"use client";

import Link from "next/link";
import { motion } from "motion/react";
import { cn } from "@/lib/utils";

type Tab = "files" | "library" | "orders" | "earnings";

interface ProfileTabsProps {
  username: string;
  activeTab: Tab;
  isOwner: boolean;
}

export function ProfileTabs({ username, activeTab, isOwner }: ProfileTabsProps) {
  const tabs: Array<{ key: Tab; label: string; ownerOnly?: boolean }> = [
    { key: "files", label: "Files" },
    { key: "library", label: "Library", ownerOnly: true },
    { key: "orders", label: "Orders", ownerOnly: true },
    { key: "earnings", label: "Earnings", ownerOnly: true },
  ];

  const visibleTabs = tabs.filter((t) => !t.ownerOnly || isOwner);

  return (
    <div className="border-b border-border">
      <nav className="flex gap-1 -mb-px">
        {visibleTabs.map((tab) => {
          const href =
            tab.key === "files" ? `/u/${username}` : `/u/${username}?tab=${tab.key}`;
          const active = activeTab === tab.key;
          return (
            <Link
              key={tab.key}
              href={href}
              scroll={false}
              className={cn(
                "relative px-4 py-2.5 text-sm font-medium transition-colors",
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
                    type: "spring",
                    stiffness: 400,
                    damping: 32,
                    mass: 0.8,
                  }}
                />
              )}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
