"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NumberInput } from "@/components/ui/number-input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { updateTokenSpendingPolicy } from "@/app/actions/tokens";
import type { SpendingPolicy } from "@/lib/billing/policy";

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
    <div className="mt-3 rounded border border-dashed border-border p-3 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <div className="text-xs font-medium">Auto-approve within policy</div>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            When on, agent orders that fit will charge your saved card without
            asking. Anything outside falls back to the email-confirmation flow.
          </p>
        </div>
        <Switch
          checked={enabled}
          onCheckedChange={handleToggle}
          disabled={disabled || pending}
          size="sm"
        />
      </div>

      {enabled && !hasPaymentMethod && (
        <div className="rounded bg-muted/40 px-3 py-2 text-[11px]">
          No payment method on file. Auto-approval needs a saved card to
          actually charge —{" "}
          <Link
            href="/dashboard/settings/billing"
            className="underline hover:text-foreground"
          >
            add a saved card
          </Link>
          . The policy will start working as soon as you do.
        </div>
      )}

      {enabled && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label
                htmlFor={`per-order-${tokenId}`}
                className="text-[11px] text-muted-foreground"
              >
                Per-order limit
              </Label>
              <NumberInput
                id={`per-order-${tokenId}`}
                inputMode="decimal"
                step="0.01"
                min="0.50"
                value={dollarsFromCents(policy.perOrderLimitCents)}
                onChange={(e) => {
                  const c = centsFromDollars(e.target.value);
                  if (c != null) update("perOrderLimitCents", c);
                }}
                className="mt-1 h-8 w-full rounded-lg border border-input bg-background px-3 text-xs shadow-xs focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/50 depth-sunken"
                disabled={disabled || pending}
              />
            </div>
            <div>
              <Label
                htmlFor={`period-budget-${tokenId}`}
                className="text-[11px] text-muted-foreground"
              >
                Per-{policy.periodWindow} budget
              </Label>
              <NumberInput
                id={`period-budget-${tokenId}`}
                inputMode="decimal"
                step="0.01"
                min="0.50"
                value={dollarsFromCents(policy.periodBudgetCents)}
                onChange={(e) => {
                  const c = centsFromDollars(e.target.value);
                  if (c != null) update("periodBudgetCents", c);
                }}
                className="mt-1 h-8 w-full rounded-lg border border-input bg-background px-3 text-xs shadow-xs focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/50 depth-sunken"
                disabled={disabled || pending}
              />
            </div>
          </div>

          <div>
            <Label className="text-[11px] text-muted-foreground">
              Budget window
            </Label>
            <div className="mt-1 flex gap-1">
              {(["day", "week", "month"] as const).map((w) => (
                <button
                  key={w}
                  type="button"
                  onClick={() => update("periodWindow", w)}
                  disabled={disabled || pending}
                  className={`rounded border px-2 py-1 text-[11px] capitalize transition-colors disabled:opacity-50 ${
                    policy.periodWindow === w
                      ? "border-foreground bg-foreground text-background"
                      : "border-border hover:bg-muted"
                  }`}
                >
                  {w}
                </button>
              ))}
            </div>
          </div>

          <div>
            <Label
              htmlFor={`confirm-above-${tokenId}`}
              className="text-[11px] text-muted-foreground"
            >
              Confirm anything above (optional)
            </Label>
            <NumberInput
              id={`confirm-above-${tokenId}`}
              inputMode="decimal"
              step="0.01"
              min="0"
              placeholder="e.g. 25.00"
              value={
                policy.confirmAboveCents != null
                  ? dollarsFromCents(policy.confirmAboveCents)
                  : ""
              }
              onChange={(e) => {
                if (e.target.value === "") {
                  update("confirmAboveCents", undefined);
                  return;
                }
                const c = centsFromDollars(e.target.value);
                if (c != null) update("confirmAboveCents", c);
              }}
              className="mt-1 h-8 w-full rounded-lg border border-input bg-background px-3 text-xs shadow-xs focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/50 depth-sunken"
              disabled={disabled || pending}
            />
          </div>

          {error && (
            <p className="text-[11px] text-destructive">{error}</p>
          )}

          <div className="flex items-center gap-2">
            <Button
              size="sm"
              onClick={handleSave}
              disabled={disabled || pending}
              className="h-7 px-3 text-xs"
            >
              Save policy
            </Button>
            {savedFlash && (
              <span className="text-[11px] text-muted-foreground">Saved.</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
