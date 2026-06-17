"use client";

import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@/components/ui/tabs";

export interface ProjectTab {
  /** Stable value used for selection. */
  value: string;
  /** Label shown on the trigger. */
  label: string;
  /** Optional count badge rendered next to the label. */
  meta?: number;
  /** Panel body — server-rendered content passed down from the page. */
  content: React.ReactNode;
}

/**
 * The project detail page's content tabs (Files, Build Guide, BOM,
 * Wiring). Sits under the cover/photos and above the Discussion
 * section. Each panel's body is rendered on the server and handed in
 * as a `content` node, so this client wrapper only owns the tab chrome
 * and selection state. Tabs are supplied already filtered for
 * visibility, so the first entry is always a safe default.
 */
export function ProjectTabs({ tabs }: { tabs: ProjectTab[] }) {
  if (tabs.length === 0) return null;
  return (
    // Single subtle container: rounded corners, subtle border, 8px
    // padding. Tabs use the flat line style and content sits directly
    // inside — no nested sub-boxes (kept deliberately un-nested).
    <Tabs
      defaultValue={tabs[0].value}
      className="gap-2 rounded-2xl border border-border bg-card p-2"
    >
      <TabsList className="w-full justify-start">
        {tabs.map((tab) => (
          <TabsTrigger key={tab.value} value={tab.value}>
            {tab.label}
            {tab.meta !== undefined && (
              <span className="ml-1.5 text-xs text-muted-foreground tabular-nums">
                {tab.meta}
              </span>
            )}
          </TabsTrigger>
        ))}
      </TabsList>
      {tabs.map((tab) => (
        <TabsContent key={tab.value} value={tab.value} className="mt-0 rounded-xl">
          {tab.content}
        </TabsContent>
      ))}
    </Tabs>
  );
}
