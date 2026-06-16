import { cn } from "@/lib/utils";

interface SandboxBadgeProps {
  className?: string;
}

/**
 * Visible heads-up that Stripe is on test keys and/or CraftCloud is
 * mocked. Sits in the nav so a tester walking the checkout flow can
 * tell at a glance that no card will be charged and no print order
 * will be placed. Detection lives server-side in `isSandboxMode()` —
 * this component just renders the chip.
 */
export function SandboxBadge({ className }: SandboxBadgeProps) {
  return (
    <span
      role="img"
      aria-label="Sandbox mode — orders will not be billed or fulfilled"
      title="Stripe test mode and/or CraftCloud mock mode is enabled — orders will not be billed or fulfilled"
      className={cn(
        "inline-flex shrink-0 items-center rounded-full bg-amber-100 p-1 text-amber-900 ring-1 ring-amber-300 dark:bg-amber-950/60 dark:text-amber-200 dark:ring-amber-800",
        className
      )}
    >
      <svg
        width={14}
        height={14}
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M10 20L14 4" />
        <path d="M18 8.00004L20.5858 10.5858C21.3668 11.3669 21.3668 12.6332 20.5858 13.4143L18 16" />
        <path d="M6 16L3.41421 13.4143C2.63316 12.6332 2.63317 11.3669 3.41421 10.5858L6 8.00004" />
      </svg>
    </span>
  );
}
