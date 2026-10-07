import { InfoIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/** The two_step "you'll see two charges" disclosure (AGENTS.md § Two-checkout flow). */
export function TwoChargesNote({ className }: { className?: string }) {
  return (
    <p
      className={cn(
        "flex gap-2 text-[13px] leading-[18px] text-muted-foreground",
        className
      )}
    >
      <InfoIcon aria-hidden="true" className="mt-px size-3.5 shrink-0" />
      <span>
        You&apos;ll see two charges: a hold for the Materialize service fee
        shown above (only charged once your order is placed) and
        CraftCloud&apos;s charge for production + shipping.
      </span>
    </p>
  );
}
