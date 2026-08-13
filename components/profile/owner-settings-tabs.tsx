"use client";

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";
import { motion } from "motion/react";
import { cn } from "@/lib/utils";

export type OwnerSettingsTab = "profile" | "general";

interface OwnerSettingsTabsProps {
  username: string;
  activeTab: OwnerSettingsTab;
}

const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

const TABS: Array<{ key: OwnerSettingsTab; label: string }> = [
  { key: "profile", label: "Profile" },
  { key: "general", label: "General" },
];

export function OwnerSettingsTabs({
  username,
  activeTab,
}: OwnerSettingsTabsProps) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [localTab, setLocalTab] = useState<OwnerSettingsTab>(activeTab);

  const navRef = useRef<HTMLElement | null>(null);
  const tabRefs = useRef<Map<OwnerSettingsTab, HTMLButtonElement | null>>(
    new Map()
  );
  const [indicator, setIndicator] = useState<{
    left: number;
    width: number;
  } | null>(null);

  useIsomorphicLayoutEffect(() => {
    const nav = navRef.current;
    const btn = tabRefs.current.get(localTab);
    if (!nav || !btn) return;

    const measure = () => {
      const navRect = nav.getBoundingClientRect();
      const btnRect = btn.getBoundingClientRect();
      setIndicator({
        left: btnRect.left - navRect.left,
        width: btnRect.width,
      });
    };
    measure();

    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(nav);
    ro.observe(btn);
    return () => ro.disconnect();
  }, [localTab]);

  const handleClick = (tab: OwnerSettingsTab) => {
    if (tab === localTab) return;
    setLocalTab(tab);
    const href =
      tab === "profile" ? `/${username}` : `/${username}?tab=general`;
    startTransition(() => {
      router.push(href, { scroll: false });
    });
  };

  return (
    <div className="border-b border-border">
      <nav ref={navRef} className="relative flex gap-1 -mb-px">
        {TABS.map((tab) => {
          const active = localTab === tab.key;
          return (
            <button
              key={tab.key}
              ref={(el) => {
                tabRefs.current.set(tab.key, el);
              }}
              type="button"
              aria-current={active ? "page" : undefined}
              onClick={() => handleClick(tab.key)}
              className={cn(
                "relative cursor-pointer px-4 py-2.5 text-sm font-medium transition-colors",
                active
                  ? "text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {tab.label}
            </button>
          );
        })}
        {indicator && (
          <motion.div
            aria-hidden
            className="absolute bottom-0 left-0 h-0.5 bg-foreground"
            initial={false}
            animate={{ x: indicator.left, width: indicator.width }}
            transition={{
              duration: 0.22,
              ease: [0.2, 0.8, 0.2, 1],
            }}
          />
        )}
      </nav>
    </div>
  );
}
