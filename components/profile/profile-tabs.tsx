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

type Tab = "library" | "orders" | "earnings" | "notifications";

interface ProfileTabsProps {
  username: string;
  activeTab: Tab;
  isOwner: boolean;
  /** Unread count drives the dot indicator on the Notifications tab. */
  unreadNotifications?: number;
}

// useLayoutEffect warns when run during SSR. Fall back to useEffect on
// the server so the measurement below stays a client-only concern.
const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

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

  // Sliding underline. Previously this was a per-button
  // `motion.div layoutId` shared-layout transition — the only use of
  // motion's layout projection in the app — which tripped React error
  // #310 ("rendered more hooks than during the previous render") on the
  // owner profile under React 19 + motion 12, because the projection
  // feature's hook set varies across the measure/commit phase. Here we
  // animate a single persistent indicator to the measured position of
  // the active tab instead: same slide, projection-free, stable hooks.
  const navRef = useRef<HTMLElement | null>(null);
  const tabRefs = useRef<Map<Tab, HTMLButtonElement | null>>(new Map());
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

    // Keep the underline aligned when the row reflows (responsive width
    // changes, font load, the notifications dot appearing). Guarded for
    // environments without ResizeObserver (jsdom in tests).
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(nav);
    ro.observe(btn);
    return () => ro.disconnect();
    // visibleTabs.length / unreadNotifications can shift button layout.
  }, [localTab, visibleTabs.length, unreadNotifications]);

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
      <nav ref={navRef} className="relative flex gap-1 -mb-px">
        {visibleTabs.map((tab) => {
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
