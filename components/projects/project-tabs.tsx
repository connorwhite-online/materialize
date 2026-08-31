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
  /** Panel body — server-rendered content passed down from the page. */
  content: React.ReactNode;
}

/**
 * The project detail page's content tabs (Files, Guide, BOM,
 * Wiring). Sits under the cover/photos and above the Discussion
 * section. Each panel's body is rendered on the server and handed in
 * as a `content` node, so this client wrapper only owns the tab chrome
 * and selection state. Tabs are supplied already filtered for
 * visibility, so the first entry is always a safe default.
 */
export function ProjectTabs({ tabs }: { tabs: ProjectTab[] }) {
  if (tabs.length === 0) return null;
  return (
    // No wrapping container — the tab line sits directly on the page
    // and content sits under it. Dropping the bordered/filled/padded box
    // removes a layer of visual nesting (the panels already carry their
    // own structure).
    <Tabs defaultValue={tabs[0].value} className="gap-2">
      <TabsList className="w-full justify-start">
        {tabs.map((tab) => (
          <TabsTrigger key={tab.value} value={tab.value}>
            {tab.label}
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
