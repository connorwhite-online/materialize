"use client";

import { MinusIcon, PlusIcon } from "lucide-react";
import { Trash } from "@/components/icons/trash";
import { cn } from "@/lib/utils";

/**
 * One line in a cart (the cart panel and the /print cart slots share
 * it): name + unit price on the left, a compact quantity stepper, the
 * line total, and a quiet remove action. Prices are cents.
 */
export function CartLineRow({
  name,
  quantity,
  unitCents,
  repricing = false,
  stale = false,
  onUpdateQty,
  onRemove,
  className,
}: {
  name: string;
  quantity: number;
  unitCents: number;
  /** Line is re-quoting after a quantity change — skeleton the money. */
  repricing?: boolean;
  /** Quote is old enough that CraftCloud may have expired it. */
  stale?: boolean;
  onUpdateQty: (qty: number) => void;
  onRemove: () => void;
  className?: string;
}) {
  const lineCents = unitCents * quantity;
  return (
    <div className={cn("py-2", className)}>
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm leading-5 font-medium">{name}</p>
          {repricing ? (
            <span className="mt-1 block h-3 w-16 animate-pulse rounded bg-muted" />
          ) : (
            <p className="text-[13px] leading-[18px] text-muted-foreground tabular-nums">
              ${(unitCents / 100).toFixed(2)} each
            </p>
          )}
        </div>

        <QuantityStepper value={quantity} label={name} onChange={onUpdateQty} />

        <span className="w-16 shrink-0 text-right text-sm font-medium tabular-nums">
          {repricing ? (
            <span className="ml-auto block h-3.5 w-12 animate-pulse rounded bg-muted" />
          ) : (
            `$${(lineCents / 100).toFixed(2)}`
          )}
        </span>

        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${name} from cart`}
          className="-mr-1 flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-full text-subtle-foreground transition-colors duration-150 hover:bg-muted hover:text-destructive focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          <Trash size={14} />
        </button>
      </div>
      {stale && (
        <p className="mt-1 text-xs text-warning">
          This quote may have expired. If checkout fails, add it again from the
          print page.
        </p>
      )}
    </div>
  );
}

/** − n + in one 28px pill. */
export function QuantityStepper({
  value,
  label,
  onChange,
  min = 1,
  max = 100,
}: {
  value: number;
  /** Item name, for the buttons' accessible names. */
  label: string;
  onChange: (qty: number) => void;
  min?: number;
  max?: number;
}) {
  const btn =
    "flex size-7 cursor-pointer items-center justify-center rounded-full text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:pointer-events-none disabled:opacity-30";
  return (
    <div className="flex h-7 shrink-0 items-center rounded-full ring-1 ring-border">
      <button
        type="button"
        onClick={() => value > min && onChange(value - 1)}
        disabled={value <= min}
        aria-label={`Decrease quantity of ${label}`}
        className={btn}
      >
        <MinusIcon className="size-3" aria-hidden="true" />
      </button>
      <span
        className="w-5 text-center text-[13px] font-medium tabular-nums"
        aria-live="polite"
      >
        {value}
      </span>
      <button
        type="button"
        onClick={() => value < max && onChange(value + 1)}
        disabled={value >= max}
        aria-label={`Increase quantity of ${label}`}
        className={btn}
      >
        <PlusIcon className="size-3" aria-hidden="true" />
      </button>
    </div>
  );
}
