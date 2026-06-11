"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { ChevronUp } from "@/components/icons/chevron-up";
import { ChevronDown } from "@/components/icons/chevron-down";

/**
 * A number input that hides the browser's native spinners and replaces
 * them with custom chevron up/down buttons using our icon family.
 */
const NumberInput = React.forwardRef<
  HTMLInputElement,
  React.ComponentPropsWithoutRef<"input">
>(({ className, step = 1, min, max, onChange, ...props }, ref) => {
  const inputRef = React.useRef<HTMLInputElement>(null);

  // Merge forwarded ref
  const setRef = (node: HTMLInputElement | null) => {
    (inputRef as React.MutableRefObject<HTMLInputElement | null>).current =
      node;
    if (typeof ref === "function") ref(node);
    else if (ref) (ref as React.MutableRefObject<HTMLInputElement | null>).current = node;
  };

  const nudge = (direction: "up" | "down") => {
    const input = inputRef.current;
    if (!input) return;
    if (direction === "up") input.stepUp();
    else input.stepDown();
    // Dispatch a synthetic change event so controlled inputs update
    input.dispatchEvent(new Event("input", { bubbles: true }));
    const event = new Event("change", { bubbles: true });
    input.dispatchEvent(event);
    onChange?.({
      target: input,
      currentTarget: input,
    } as React.ChangeEvent<HTMLInputElement>);
  };

  return (
    <div className="relative flex items-center">
      <input
        ref={setRef}
        type="number"
        step={step}
        min={min}
        max={max}
        onChange={onChange}
        className={cn(
          // hide native spinners across browsers
          "[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none",
          // right-pad to make room for the chevron column
          "pr-7",
          className
        )}
        {...props}
      />
      <div className="absolute right-0 flex h-full flex-col border-l border-input">
        <button
          type="button"
          tabIndex={-1}
          aria-label="Increase"
          onClick={() => nudge("up")}
          className="flex flex-1 cursor-pointer items-center justify-center px-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <ChevronUp size={10} strokeWidth={3} />
        </button>
        <button
          type="button"
          tabIndex={-1}
          aria-label="Decrease"
          onClick={() => nudge("down")}
          className="flex flex-1 cursor-pointer items-center justify-center border-t border-input px-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <ChevronDown size={10} strokeWidth={3} />
        </button>
      </div>
    </div>
  );
});
NumberInput.displayName = "NumberInput";

export { NumberInput };
