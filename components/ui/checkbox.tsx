"use client"

import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox"

import { cn } from "@/lib/utils"
import { CheckIcon } from "lucide-react"

function Checkbox({ className, ...props }: CheckboxPrimitive.Root.Props) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        "peer relative flex size-4 shrink-0 items-center justify-center rounded-[4px] border border-input transition-colors outline-none group-has-disabled/field:opacity-50 after:absolute after:-inset-x-3 after:-inset-y-2 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 aria-invalid:aria-checked:border-primary dark:bg-input/30 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 data-checked:border-primary data-checked:bg-primary data-checked:text-primary-foreground dark:data-checked:bg-primary",
        className
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="grid place-content-center text-current transition-none [&>svg]:size-3.5"
      >
        <CheckIcon
        />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}

type CheckboxFieldProps = {
  id: string
  label: React.ReactNode
  description?: React.ReactNode
  className?: string
  labelClassName?: string
} & Omit<CheckboxPrimitive.Root.Props, "id" | "className">

// Wraps Checkbox + label text in a clickable <label> with the
// alignment dialed in. We use a raw <label> (not the Label
// component) because Label carries a default mb-2 that throws off
// vertical centering — items-center against a 16px checkbox pulls
// the text optically high. items-start + a 1px top nudge on the
// checkbox sits its visual midline on the text cap-height for both
// single-line labels and label+description stacks.
function CheckboxField({
  id,
  label,
  description,
  className,
  labelClassName,
  ...checkboxProps
}: CheckboxFieldProps) {
  return (
    <label
      htmlFor={id}
      className={cn(
        "flex cursor-pointer items-start gap-2 select-none",
        className
      )}
    >
      <Checkbox id={id} className="mt-px" {...checkboxProps} />
      <div className={cn("text-sm leading-snug", labelClassName)}>
        <span>{label}</span>
        {description && (
          <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
        )}
      </div>
    </label>
  )
}

export { Checkbox, CheckboxField }
