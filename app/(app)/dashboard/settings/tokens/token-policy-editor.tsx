"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { NumberInput } from "@/components/ui/number-input";
import { Field } from "@/components/ui/field";
import { Switch } from "@/components/ui/switch";
import { updateTokenSpendingPolicy } from "@/app/actions/tokens";
import type { SpendingPolicy } from "@/lib/billing/policy";
import { SegmentedControl } from "@/components/ui/segmented-control";

// Matches <Input>'s field treatment. Keeps NumberInput's own 16px
// `field-text` (no text-xs override — that let iOS zoom on focus) and its
// pr-7 chevron gutter (a px-* override let digits run under the arrows).
const FIELD_CLASS =
  "h-9 w-full rounded-[10px] border border-input bg-background pl-6 tabular-nums outline-none transition-[background-color,box-shadow,border-color] duration-150 hover:border-foreground/25 focus-visible:border-ring focus-visible:shadow-input-focus";

interface Props {
  tokenId: string;
  initialPolicy: SpendingPolicy | null;
  /** True when the user has saved a card. Off → show "add card first" CTA. */
  hasPaymentMethod: boolean;
  /** Disabled state when the token is revoked. */
  disabled?: boolean;
  onChange?: (policy: SpendingPolicy | null) => void;
}

const DEFAULT_POLICY: SpendingPolicy = {
  perOrderLimitCents: 5000,
  periodBudgetCents: 20000,
  periodWindow: "month",
};

function dollarsFromCents(c: number): string {
  return (c / 100).toFixed(2);
}

function centsFromDollars(s: string): number | null {
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

export function TokenPolicyEditor({
  tokenId,
  initialPolicy,
  hasPaymentMethod,
  disabled,
  onChange,
}: Props) {
  const [enabled, setEnabled] = useState(initialPolicy != null);
  const [policy, setPolicy] = useState<SpendingPolicy>(
    initialPolicy ?? DEFAULT_POLICY
  );
  const [error, setError] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);
  const [pending, startTransition] = useTransition();

  const update = <K extends keyof SpendingPolicy>(
    key: K,
    value: SpendingPolicy[K]
  ) => {
    setPolicy((prev) => ({ ...prev, [key]: value }));
  };

  const persist = (next: SpendingPolicy | null) => {
    setError(null);
    startTransition(async () => {
      const result = await updateTokenSpendingPolicy({
        tokenId,
        policy: next,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 2000);
      onChange?.(next);
    });
  };

  const handleToggle = (next: boolean) => {
    setEnabled(next);
    if (!next) {
      // Turning off → null out the policy
      persist(null);
    } else {
      // Turning on → save the current form state
      persist(policy);
    }
  };

  const handleSave = () => persist(policy);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <label
            htmlFor={`auto-approve-${tokenId}`}
            className="block text-sm leading-5 font-medium"
          >
            Auto-approve orders
          </label>
          <p className="mt-0.5 text-[13px] leading-[18px] text-pretty text-muted-foreground">
            Orders inside these limits charge your saved card without asking.
            Anything else waits for your email confirmation.
          </p>
        </div>
        <Switch
          id={`auto-approve-${tokenId}`}
          checked={enabled}
          onCheckedChange={handleToggle}
          disabled={disabled || pending}
          className="mt-0.5"
        />
      </div>

      {enabled && !hasPaymentMethod && (
        <p className="text-[13px] leading-[18px] text-warning">
          No saved card yet, so nothing can be charged.{" "}
          <Link
            href="/dashboard/settings/billing"
            className="underline underline-offset-2 hover:no-underline"
          >
            Add a card
          </Link>{" "}
          and the limits apply right away.
        </p>
      )}

      {enabled && (
        <div className="mz-enter flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3 sm:max-w-md">
            <Field label="Per order" htmlFor={`per-order-${tokenId}`}>
              <DollarInput
                id={`per-order-${tokenId}`}
                min="0.50"
                value={dollarsFromCents(policy.perOrderLimitCents)}
                onChange={(v) => {
                  const c = centsFromDollars(v);
                  if (c != null) update("perOrderLimitCents", c);
                }}
                disabled={disabled || pending}
              />
            </Field>
            <Field
              label={`Per ${policy.periodWindow}`}
              htmlFor={`period-budget-${tokenId}`}
            >
              <DollarInput
                id={`period-budget-${tokenId}`}
                min="0.50"
                value={dollarsFromCents(policy.periodBudgetCents)}
                onChange={(v) => {
                  const c = centsFromDollars(v);
                  if (c != null) update("periodBudgetCents", c);
                }}
                disabled={disabled || pending}
              />
            </Field>
          </div>

          <Field label="Budget resets every">
            <SegmentedControl
              listClassName="w-fit"
              value={policy.periodWindow}
              onValueChange={(w) => update("periodWindow", w)}
              items={(["day", "week", "month"] as const).map((w) => ({
                value: w,
                label: <span className="capitalize">{w}</span>,
                disabled: disabled || pending,
              }))}
            />
          </Field>

          <Field
            label="Always confirm above"
            htmlFor={`confirm-above-${tokenId}`}
            optional
            hint="Orders over this still ask you first, even within budget."
            className="sm:max-w-[17rem]"
          >
            <DollarInput
              id={`confirm-above-${tokenId}`}
              min="0"
              placeholder="25.00"
              value={
                policy.confirmAboveCents != null
                  ? dollarsFromCents(policy.confirmAboveCents)
                  : ""
              }
              onChange={(v) => {
                if (v === "") {
                  update("confirmAboveCents", undefined);
                  return;
                }
                const c = centsFromDollars(v);
                if (c != null) update("confirmAboveCents", c);
              }}
              disabled={disabled || pending}
            />
          </Field>

          {error && (
            <p role="alert" className="text-[13px] leading-[18px] text-destructive">
              {error}
            </p>
          )}

          <div className="flex items-center gap-3">
            <Button
              size="sm"
              variant="secondary"
              onClick={handleSave}
              disabled={disabled || pending}
            >
              Save limits
            </Button>
            {savedFlash && (
              <span
                aria-live="polite"
                className="text-[13px] text-muted-foreground"
              >
                Saved
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** Dollar amount field: "$" prefix inside the box, numeric keypad. */
function DollarInput({
  id,
  value,
  onChange,
  min,
  placeholder,
  disabled,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  min: string;
  placeholder?: string;
  disabled?: boolean;
}) {
  return (
    <div className="relative">
      <span
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 left-3 z-10 -translate-y-1/2 text-sm text-muted-foreground"
      >
        $
      </span>
      <NumberInput
        id={id}
        inputMode="decimal"
        step="0.01"
        min={min}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={FIELD_CLASS}
        disabled={disabled}
      />
    </div>
  );
}
