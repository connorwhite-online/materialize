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
import {
  OWNER_SETTINGS_TAB_ALIASES,
  ownerSettingsHref,
  type OwnerSettingsTab,
} from "@/lib/profile/owner-settings-tabs";

const TABS: Array<{ key: OwnerSettingsTab; label: string }> = [
  { key: "settings", label: "Settings" },
  { key: "agents", label: "Agents" },
  { key: "payments", label: "Payments" },
];

interface OwnerSettingsTabsProps {
  username: string;
  activeTab: OwnerSettingsTab;
}

const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

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
    const next = url.pathname + (url.searchParams.toString() ? `?${url.searchParams}` : "");
    window.history.replaceState(null, "", next);
  }, []);

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
    startTransition(() => {
      router.push(ownerSettingsHref(username, tab), { scroll: false });
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
