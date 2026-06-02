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
      title="Stripe test mode and/or CraftCloud mock mode is enabled — orders will not be billed or fulfilled"
      className={cn(
        "inline-flex shrink-0 items-center rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-900 ring-1 ring-amber-300 dark:bg-amber-950/60 dark:text-amber-200 dark:ring-amber-800",
        className
      )}
    >
      Sandbox
    </span>
  );
}
