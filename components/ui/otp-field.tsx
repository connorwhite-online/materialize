"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

interface OtpFieldProps {
  value: string;
  onChange: (value: string) => void;
  length?: number;
  autoFocus?: boolean;
  disabled?: boolean;
  className?: string;
  /** Accessible name; defaults to "Verification code". */
  "aria-label"?: string;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
}

/**
 * One-time-code entry drawn as N boxes over ONE native numeric input.
 *
 * Everything is in normal flow: the boxes and the input share a single grid
 * cell, so the row's height always comes from the boxes. Nothing is
 * absolutely positioned and no size is measured at runtime. That is the
 * point — the `input-otp` library's absolutely-positioned hidden input left
 * the row with no layout height in Safari, so the boxes painted over the
 * copy and link around them.
 *
 * The input is invisible (opacity 0) but real and on top, so taps focus it
 * directly and iOS/Safari one-time-code autofill, paste and the numeric
 * keypad all behave as they do on any input.
 */
export function OtpField({
  value,
  onChange,
  length = 6,
  autoFocus,
  disabled,
  className,
  "aria-label": ariaLabel = "Verification code",
  "aria-invalid": ariaInvalid,
  "aria-describedby": ariaDescribedBy,
}: OtpFieldProps) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [focused, setFocused] = React.useState(false);
  const [selection, setSelection] = React.useState({ start: 0, end: 0 });

  // Mirror the input's selection into state so the boxes can show where the
  // caret is, and keep a collapsed caret sitting ON a filled box as a
  // one-character selection so typing overwrites that digit in place (the
  // behaviour people expect from a code field) instead of inserting.
  const syncSelection = React.useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    let start = el.selectionStart ?? el.value.length;
    let end = el.selectionEnd ?? start;
    if (start === end && start < el.value.length) {
      end = start + 1;
      el.setSelectionRange(start, end);
    }
    start = Math.min(start, length - 1);
    setSelection({ start, end: Math.max(end, start) });
  }, [length]);

  // Put the caret where a box was tapped. The input covers the whole row but
  // its text is invisible, so the browser's own caret placement is meaningless;
  // derive the index from the tap's x position instead.
  const placeCaretFromPointer = (e: React.MouseEvent<HTMLInputElement>) => {
    const el = e.currentTarget;
    const rect = el.getBoundingClientRect();
    const index = Math.min(
      Math.floor(((e.clientX - rect.left) / rect.width) * length),
      el.value.length,
    );
    el.setSelectionRange(index, Math.min(index + 1, el.value.length));
    syncSelection();
  };

  return (
    <div className={cn("group/otp grid h-12 justify-center", className)}>
      <div
        aria-hidden
        className="col-start-1 row-start-1 flex items-center gap-1.5"
      >
        {Array.from({ length }, (_, i) => {
          const isActive =
            focused &&
            (selection.end > selection.start
              ? i >= selection.start && i < selection.end
              : i === selection.start);
          return (
            <div
              key={i}
              data-slot="otp-field-slot"
              data-active={isActive}
              className="relative flex h-12 w-10 items-center justify-center rounded-xl border border-foreground/25 bg-muted/60 text-base font-medium text-foreground shadow-sunken transition-[color,box-shadow,border-color] duration-150 ease-out data-[active=true]:z-10 data-[active=true]:border-ring data-[active=true]:shadow-input-focus group-aria-invalid/otp:border-destructive dark:border-foreground/30 dark:bg-input/30"
            >
              {value[i]}
              {isActive && !value[i] && (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                  <div className="h-5 w-px animate-caret-blink bg-foreground duration-1000" />
                </div>
              )}
            </div>
          );
        })}
      </div>
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => {
          onChange(e.target.value.replace(/\D/g, "").slice(0, length));
          // The caret moves after React commits the new value.
          requestAnimationFrame(syncSelection);
        }}
        onClick={placeCaretFromPointer}
        onSelect={syncSelection}
        onFocus={() => {
          setFocused(true);
          syncSelection();
        }}
        onBlur={() => setFocused(false)}
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]*"
        maxLength={length}
        aria-label={ariaLabel}
        aria-invalid={ariaInvalid}
        aria-describedby={ariaDescribedBy}
        autoFocus={autoFocus}
        disabled={disabled}
        className="field-text col-start-1 row-start-1 h-full w-full cursor-text appearance-none border-0 bg-transparent p-0 text-transparent caret-transparent opacity-0 outline-none"
      />
    </div>
  );
}
