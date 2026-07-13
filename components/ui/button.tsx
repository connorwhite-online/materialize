import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  // transition-property is enumerated (never `transition: all`) so only
  // color/shadow/transform animate — keeps press + hover crisp.
  // Top sheen is a soft vertical gradient (::before), not a hard 1px inset
  // highlight — that edge read as fake chrome.
  "group/button relative inline-flex shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-full border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-[color,background-color,border-color,box-shadow,transform] duration-150 ease-out outline-none select-none before:pointer-events-none before:absolute before:inset-x-0 before:top-0 before:h-[58%] before:bg-gradient-to-b before:from-white/0 before:to-transparent before:content-[''] before:opacity-0 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 active:not-aria-[haspopup]:translate-y-px active:not-aria-[haspopup]:scale-[0.98] disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground shadow-[0_1px_2px_rgba(0,0,0,0.14),0_4px_8px_-4px_rgba(0,0,0,0.35)] before:from-white/28 before:opacity-100 hover:bg-primary/90 hover:shadow-[0_2px_3px_rgba(0,0,0,0.16),0_6px_12px_-5px_rgba(0,0,0,0.4)] hover:before:from-white/34 active:shadow-[inset_0_1px_2px_rgba(0,0,0,0.18),0_1px_2px_rgba(0,0,0,0.12)] active:before:from-white/12 active:before:opacity-70",
        outline:
          "border-border bg-card/80 shadow-[0_2px_5px_-2px_rgba(0,0,0,0.16)] backdrop-blur-sm before:from-white/55 before:opacity-100 hover:bg-card hover:text-foreground hover:shadow-[0_4px_8px_-4px_rgba(0,0,0,0.24)] hover:before:from-white/65 aria-expanded:bg-muted aria-expanded:text-foreground active:before:from-white/30 active:before:opacity-70 dark:border-input dark:bg-input/30 dark:shadow-[0_2px_5px_-2px_rgba(0,0,0,0.5)] dark:before:from-white/12 dark:hover:bg-input/50 dark:hover:before:from-white/16",
        secondary:
          "bg-secondary/80 text-secondary-foreground shadow-[0_3px_7px_-3px_rgba(0,0,0,0.22)] backdrop-blur-sm before:from-white/42 before:opacity-100 hover:bg-secondary hover:shadow-[0_5px_10px_-5px_rgba(0,0,0,0.28)] hover:before:from-white/52 aria-expanded:bg-secondary aria-expanded:text-secondary-foreground active:before:from-white/22 active:before:opacity-70 dark:before:from-white/14 dark:shadow-[0_3px_7px_-3px_rgba(0,0,0,0.55)] dark:hover:before:from-white/18",
        ghost:
          "hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:hover:bg-muted/50",
        destructive:
          "bg-destructive/10 text-destructive hover:bg-destructive/20 focus-visible:border-destructive/40 focus-visible:ring-destructive/20 dark:bg-destructive/20 dark:hover:bg-destructive/30 dark:focus-visible:ring-destructive/40",
        link: "overflow-visible text-primary underline-offset-4 hover:underline",
      },
      size: {
        default:
          "h-9 gap-1.5 px-4 has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3",
        xs: "h-7 gap-1 px-2.5 text-xs in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-8 gap-1 px-3 text-[0.8rem] in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-10 gap-1.5 px-5 has-data-[icon=inline-end]:pr-4 has-data-[icon=inline-start]:pl-4",
        xl: "h-12 gap-2 px-6 text-[0.95rem] has-data-[icon=inline-end]:pr-5 has-data-[icon=inline-start]:pl-5",
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
