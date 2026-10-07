import type * as React from "react";

import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/**
 * Form and settings layout, after ChatGPT's settings and Vercel/Linear
 * forms. The rules these encode (see DESIGN_SYSTEM.md § Forms):
 *
 * - A form is a narrow column (`FieldGroup`, max 28rem), never a card
 *   stretched to the page. Fields stack 20px apart; a label sits 6px
 *   above its control, a hint 6px below it.
 * - Actions sit at natural width in `FormActions`, primary last (right)
 *   — never a full-width bar, except inside auth/sheet columns that are
 *   already as narrow as the button.
 * - Preferences are rows, not forms: `SettingsGroup` + `SettingsRow`
 *   put the title and explanation on the left and the control on the
 *   right, separated by hairlines, like ChatGPT's settings panel.
 */

export function FieldGroup({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="field-group"
      className={cn("flex w-full max-w-md flex-col gap-5", className)}
      {...props}
    />
  );
}

export function Field({
  label,
  htmlFor,
  hint,
  error,
  optional,
  className,
  children,
}: {
  label?: React.ReactNode;
  htmlFor?: string;
  /** Helper text under the control. Hidden while `error` shows. */
  hint?: React.ReactNode;
  error?: React.ReactNode;
  /** Marks the field "Optional" beside the label. */
  optional?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div data-slot="field" className={cn("flex flex-col", className)}>
      {label && (
        <Label htmlFor={htmlFor} className="justify-between">
          <span>{label}</span>
          {optional && (
            <span className="text-xs font-normal text-subtle-foreground">
              Optional
            </span>
          )}
        </Label>
      )}
      {children}
      {error ? (
        <p role="alert" className="mt-1.5 text-[13px] leading-[18px] text-destructive">
          {error}
        </p>
      ) : (
        hint && (
          <p className="mt-1.5 text-[13px] leading-[18px] text-muted-foreground">
            {hint}
          </p>
        )
      )}
    </div>
  );
}

export function FormActions({
  className,
  align = "end",
  ...props
}: React.ComponentProps<"div"> & { align?: "start" | "end" | "between" }) {
  return (
    <div
      data-slot="form-actions"
      className={cn(
        "flex flex-wrap items-center gap-2 pt-1",
        align === "end" && "justify-end",
        align === "between" && "justify-between",
        className
      )}
      {...props}
    />
  );
}

/** A titled stack of SettingsRows, separated by hairlines. */
export function SettingsGroup({
  title,
  description,
  className,
  children,
}: {
  title?: React.ReactNode;
  description?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section data-slot="settings-group" className={cn("flex flex-col", className)}>
      {title && (
        <div className="mb-1">
          <h2 className="text-base leading-6 font-semibold">{title}</h2>
          {description && (
            <p className="text-sm text-muted-foreground">{description}</p>
          )}
        </div>
      )}
      <div className="flex flex-col divide-y divide-border">{children}</div>
    </section>
  );
}

export function SettingsRow({
  title,
  description,
  control,
  htmlFor,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  control?: React.ReactNode;
  /** Makes the title a label for the control (switches, selects). */
  htmlFor?: string;
  className?: string;
}) {
  const Title = htmlFor ? "label" : "p";
  return (
    <div
      data-slot="settings-row"
      className={cn("flex min-h-14 items-center justify-between gap-6 py-3", className)}
    >
      <div className="min-w-0">
        <Title htmlFor={htmlFor} className="block text-sm leading-5 font-medium">
          {title}
        </Title>
        {description && (
          <p className="mt-0.5 text-[13px] leading-[18px] text-pretty text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      {control && <div className="flex shrink-0 items-center gap-2">{control}</div>}
    </div>
  );
}
