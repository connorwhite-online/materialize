"use client";

import Link from "next/link";
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
      <nav className="flex gap-6 -mb-px">
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
                "py-2 text-sm font-medium transition-colors border-b-2",
                active
                  ? "text-foreground border-foreground"
                  : "text-muted-foreground border-transparent hover:text-foreground"
              )}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
