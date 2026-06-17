import type { ReactNode } from "react";

/**
 * Admin-only bar pinned above an owned entity's page (project, file,
 * collection). Visibility status on the left, owner action buttons
 * (passed as children) on the right, in a compact rounded container.
 *
 * Render it only for owners / collaborators. Status is always shown;
 * pass owner-only controls as children so collaborators see the bar
 * without the destructive actions.
 */
export function OwnerBar({
  visibility,
  children,
}: {
  visibility: "public" | "private";
  children?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-full border border-border bg-muted/30 px-2.5 py-1.5">
      <span
        className={`inline-flex h-8 items-center rounded-full px-3 text-xs font-medium ${
          visibility === "public"
            ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
            : "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400"
        }`}
      >
        {visibility === "public" ? "Public" : "Private"}
      </span>
      {children && <div className="flex items-center gap-1.5">{children}</div>}
    </div>
  );
}
