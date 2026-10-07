import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  // transition-property is enumerated (never `transition: all`) so only
  // color/shadow/transform animate — keeps press + hover crisp.
  "group/button inline-flex shrink-0 cursor-pointer items-center justify-center rounded-full border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-[color,background-color,border-color,box-shadow,transform] duration-150 ease-out outline-none select-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background active:not-aria-[haspopup]:scale-[0.98] disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        // Flat fills after ChatGPT: no glow, no inset well. Feedback is a
        // fill step on hover and the scale on press.
        default:
          // bg-clip-border (not the base's padding-box) so the fill runs
          // under the transparent 1px border instead of leaving a halo.
          "bg-clip-border bg-primary text-primary-foreground hover:bg-primary/85",
        outline:
          "border-foreground/12 bg-background hover:bg-muted/70 aria-expanded:bg-muted aria-expanded:text-foreground",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-foreground/[0.09] aria-expanded:bg-foreground/[0.09]",
        ghost:
          "hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground",
        destructive:
          "bg-destructive text-white hover:bg-destructive/90 focus-visible:ring-destructive",
        link: "overflow-visible text-primary underline-offset-4 hover:underline",
      },
      size: {
        default:
          "h-9 gap-1.5 px-4 has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3",
        xs: "h-7 gap-1 px-2.5 text-xs in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-8 gap-1 px-3 text-[0.8rem] in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-10 gap-1.5 px-5 has-data-[icon=inline-end]:pr-4 has-data-[icon=inline-start]:pl-4",
        xl: "h-11 gap-2 px-5 text-[0.95rem] has-data-[icon=inline-end]:pr-4 has-data-[icon=inline-start]:pl-4",
        icon: "size-9",
        "icon-xs":
          "size-7 in-data-[slot=button-group]:rounded-lg [&_svg:not([class*='size-'])]:size-3",
        "icon-sm":
          "size-8 in-data-[slot=button-group]:rounded-lg",
        "icon-lg": "size-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  nativeButton,
  render,
  loading = false,
  disabled,
  children,
  ...props
}: ButtonPrimitive.Props &
  VariantProps<typeof buttonVariants> & {
    /**
     * Show a spinner before the label and disable the button. Use this
     * instead of swapping the label for "…" so pending actions read as
     * loading everywhere.
     */
    loading?: boolean
  }) {
  // Base-UI's Button defaults nativeButton to true, which warns if the
  // `render` prop yields a non-<button> element (e.g. <Link> → <a>).
  // Default nativeButton to false whenever the caller is explicitly
  // rendering as something else, so `<Button render={<Link ... />}>`
  // just works without every call site having to remember.
  const resolvedNativeButton = nativeButton ?? render == null;
  return (
    <ButtonPrimitive
      className={cn(buttonVariants({ variant, size, className }))}
      nativeButton={resolvedNativeButton}
      render={render}
      disabled={disabled || loading}
      {...props}
      data-slot="button"
    >
      {loading && (
        <span
          aria-hidden
          className="size-3.5 animate-spin rounded-full border-2 border-current/30 border-t-current"
        />
      )}
      {children}
    </ButtonPrimitive>
  )
}

export { Button, buttonVariants }
