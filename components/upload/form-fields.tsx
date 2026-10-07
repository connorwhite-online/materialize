"use client";

import type * as React from "react";
import { CheckIcon } from "lucide-react";

import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { LICENSES, LICENSE_ORDER, type LicenseId } from "@/lib/licenses";
import { DESIGN_TAG_LABELS, DESIGN_TAG_OPTIONS } from "@/lib/validations/file";
import { cn } from "@/lib/utils";

/**
 * Field pieces shared by every listing form — the upload metadata form,
 * new project / collection, and the edit-file / edit-project dialogs.
 * Before these, each form hand-rolled its own visibility select, license
 * select, sale card and cover picker, and they had drifted (11px vs 12px
 * hints, a border-2 primary ring here, a gradient there).
 */

/** A titled group of fields. Space and a heading, never a card. */
export function FormSection({
  title,
  description,
  action,
  className,
  children,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={cn("flex min-w-0 flex-col gap-5", className)}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-base leading-6 font-semibold">{title}</h2>
          {description && (
            <p className="mt-0.5 text-[13px] leading-[18px] text-pretty text-muted-foreground">
              {description}
            </p>
          )}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

export type Visibility = "public" | "private";

/**
 * Public / Private as two radio cards rather than a select: it's a
 * choice of two with consequences, and the consequence belongs next to
 * the option, not in a hint that changes after you pick.
 */
export function VisibilityField({
  value,
  onChange,
  name = "visibility-choice",
  privateDescription = "Only you can see it.",
  label = "Visibility",
}: {
  value: Visibility;
  onChange: (value: Visibility) => void;
  name?: string;
  privateDescription?: string;
  label?: string;
}) {
  const options: Array<{
    value: Visibility;
    title: string;
    description: string;
  }> = [
    {
      value: "public",
      title: "Public",
      description: "Shows in browse and search.",
    },
    { value: "private", title: "Private", description: privateDescription },
  ];
  return (
    <fieldset className="flex min-w-0 flex-col">
      <legend className="mb-1.5 text-sm leading-5 font-medium">{label}</legend>
      <div className="grid grid-cols-2 gap-2">
        {options.map((o) => (
          <ChoiceCard
            key={o.value}
            name={name}
            checked={value === o.value}
            onChange={() => onChange(o.value)}
            title={o.title}
            description={o.description}
          />
        ))}
      </div>
    </fieldset>
  );
}

/** One radio card: title + one line, a foreground edge and a check when chosen. */
export function ChoiceCard({
  name,
  checked,
  onChange,
  title,
  description,
}: {
  name: string;
  checked: boolean;
  onChange: () => void;
  title: React.ReactNode;
  description?: React.ReactNode;
}) {
  return (
    <label
      className={cn(
        // White like the inputs around it (a muted fill vanishes on a
        // dialog's frosted surface); chosen = a foreground hairline and
        // a filled check, never a thick coloured border.
        "relative flex min-w-0 cursor-pointer flex-col rounded-xl border bg-background px-3 py-2.5 transition-[border-color,box-shadow] duration-150 has-focus-visible:shadow-input-focus",
        checked
          ? "border-foreground"
          : "border-input hover:border-foreground/25",
      )}
    >
      <input
        type="radio"
        name={name}
        checked={checked}
        onChange={onChange}
        className="sr-only"
      />
      <span className="flex items-center justify-between gap-2 text-sm leading-5 font-medium">
        {title}
        <span
          aria-hidden
          className={cn(
            "flex size-4 shrink-0 items-center justify-center rounded-full",
            checked
              ? "bg-foreground text-background"
              : "ring-1 ring-foreground/20 ring-inset",
          )}
        >
          {checked && <CheckIcon className="size-3" strokeWidth={3} />}
        </span>
      </span>
      {description && (
        <span className="mt-0.5 text-[13px] leading-[18px] text-muted-foreground">
          {description}
        </span>
      )}
    </label>
  );
}

/** License select; the hint states what the chosen license allows. */
export function LicenseField({
  id,
  value,
  onChange,
}: {
  id: string;
  value: LicenseId;
  onChange: (value: LicenseId) => void;
}) {
  const meta = LICENSES[value];
  return (
    <Field
      label="License"
      htmlFor={id}
      hint={meta ? meta.summary : "Controls what people can do with the files."}
    >
      <Select
        value={value}
        onValueChange={(v) => v && onChange(v as LicenseId)}
      >
        <SelectTrigger id={id} className="w-full">
          <SelectValue>
            {(v) => {
              const m = LICENSES[v as LicenseId];
              return m ? `${m.shortName} — ${m.name}` : "Select a license";
            }}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {LICENSE_ORDER.map((lid) => {
            const m = LICENSES[lid];
            return (
              <SelectItem key={lid} value={lid}>
                <div className="flex flex-col gap-0.5 py-0.5">
                  <span>
                    {m.shortName} — {m.name}
                  </span>
                  <span className="text-xs leading-4 whitespace-normal text-muted-foreground">
                    {m.summary}
                  </span>
                </div>
              </SelectItem>
            );
          })}
        </SelectContent>
      </Select>
    </Field>
  );
}

/** A dollar input with a quiet "$" prefix. */
export function PriceInput({
  className,
  ...props
}: React.ComponentProps<typeof Input>) {
  return (
    <div className={cn("relative", className)}>
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-base text-subtle-foreground md:text-sm"
      >
        $
      </span>
      <Input
        type="number"
        inputMode="decimal"
        min="0"
        step="0.01"
        className="pl-6 tabular-nums"
        {...props}
      />
    </div>
  );
}

/**
 * "Sell this" as a settings row (title + consequence left, switch
 * right) that reveals the price field — the ChatGPT settings pattern
 * rather than a card with a switch in its header.
 */
export function SaleField({
  id,
  enabled,
  onEnabledChange,
  title = "Sell this file",
  description = "Buyers pay before downloading. Leave off to share it free.",
  children,
}: {
  id: string;
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
  title?: string;
  description?: string;
  /** The price field, rendered while enabled. */
  children?: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex items-center justify-between gap-6">
        <div className="min-w-0">
          <label
            htmlFor={id}
            className="block cursor-pointer text-sm leading-5 font-medium"
          >
            {title}
          </label>
          <p className="mt-0.5 text-[13px] leading-[18px] text-pretty text-muted-foreground">
            {description}
          </p>
        </div>
        <Switch id={id} checked={enabled} onCheckedChange={onEnabledChange} />
      </div>
      {enabled && children}
    </div>
  );
}

/** Toggle chips for "This part needs to be…" design tags. */
export function DesignTagChips({
  selected,
  onToggle,
}: {
  selected: string[];
  onToggle: (tag: string) => void;
}) {
  return (
    <fieldset className="flex min-w-0 flex-col">
      <legend className="mb-1.5 text-sm leading-5 font-medium">
        This part needs to be
      </legend>
      <div className="flex flex-wrap gap-2">
        {DESIGN_TAG_OPTIONS.map((tag) => {
          const on = selected.includes(tag);
          return (
            <button
              key={tag}
              type="button"
              aria-pressed={on}
              onClick={() => onToggle(tag)}
              className={cn(
                "inline-flex h-8 cursor-pointer items-center gap-1 rounded-full px-3 text-[13px] font-medium transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                on
                  ? "bg-foreground text-background"
                  : "bg-secondary text-secondary-foreground hover:bg-foreground/[0.09]",
              )}
            >
              {on && (
                <CheckIcon className="-ml-0.5 size-3.5" strokeWidth={2.5} />
              )}
              {DESIGN_TAG_LABELS[tag]}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

/**
 * Cover image picker shared by the edit-file and edit-project dialogs:
 * "Auto" first, then each photo. Selection is a foreground ring plus a
 * check, not a primary-coloured border.
 */
export function CoverPicker({
  autoSrc,
  photos,
  value,
  onChange,
  hint,
  error,
}: {
  /** Preview for the "Auto" option. */
  autoSrc: string;
  photos: Array<{ id: string; downloadUrl: string }>;
  /** "" = Auto, otherwise a photo id. */
  value: string;
  onChange: (value: string) => void;
  hint?: React.ReactNode;
  error?: React.ReactNode;
}) {
  const tiles = [{ id: "", src: autoSrc, auto: true }].concat(
    photos.map((p) => ({ id: p.id, src: p.downloadUrl, auto: false })),
  );
  return (
    <fieldset className="flex min-w-0 flex-col">
      <legend className="mb-1.5 text-sm leading-5 font-medium">
        Cover image
      </legend>
      <div className="-m-1 flex gap-2 overflow-x-auto p-1">
        {tiles.map((t) => {
          const on = value === t.id;
          return (
            <button
              key={t.id || "auto"}
              type="button"
              onClick={() => onChange(t.id)}
              aria-pressed={on}
              aria-label={t.auto ? "Automatic cover" : "Use this photo"}
              className={cn(
                "relative size-16 shrink-0 cursor-pointer overflow-hidden rounded-[10px] bg-muted transition-shadow duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                on
                  ? "ring-2 ring-foreground ring-offset-2 ring-offset-background"
                  : "ring-1 ring-border hover:ring-foreground/30",
              )}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={t.src}
                alt=""
                className="absolute inset-0 size-full object-cover"
              />
              {t.auto && (
                <span className="absolute inset-x-1 bottom-1 rounded-md bg-background/90 py-px text-center text-[10px] leading-[14px] font-medium text-foreground">
                  Auto
                </span>
              )}
              {on && (
                <span className="absolute top-1 right-1 flex size-4 items-center justify-center rounded-full bg-foreground text-background">
                  <CheckIcon className="size-3" strokeWidth={3} />
                </span>
              )}
            </button>
          );
        })}
      </div>
      {error ? (
        <p
          role="alert"
          className="mt-1.5 text-[13px] leading-[18px] text-destructive"
        >
          {error}
        </p>
      ) : (
        hint && (
          <p className="mt-1.5 text-[13px] leading-[18px] text-muted-foreground">
            {hint}
          </p>
        )
      )}
    </fieldset>
  );
}

/** Inline form-level error, shown just above the actions. */
export function FormError({ children }: { children?: React.ReactNode }) {
  if (!children) return null;
  return (
    <p
      role="alert"
      className="rounded-[10px] bg-destructive/10 px-3 py-2 text-[13px] leading-[18px] text-destructive"
    >
      {children}
    </p>
  );
}
