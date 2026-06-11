"use client";

import { Tooltip } from "@base-ui/react/tooltip";

/**
 * Shows the full filename in a styled tooltip when the h3 is truncated.
 * Renders the h3 itself as the trigger so semantics stay intact.
 */
export function FileTitleTooltip({
  title,
  className,
}: {
  title: string;
  className?: string;
}) {
  return (
    <Tooltip.Provider delay={500}>
    <Tooltip.Root>
      <Tooltip.Trigger
        render={<h3 className={className} />}
      >
        {title}
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Positioner sideOffset={6} align="start">
          <Tooltip.Popup className="max-w-xs rounded-lg border border-border bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-md">
            {title}
          </Tooltip.Popup>
        </Tooltip.Positioner>
      </Tooltip.Portal>
    </Tooltip.Root>
    </Tooltip.Provider>
  );
}
