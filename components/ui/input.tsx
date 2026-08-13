import * as React from "react"

import { cn } from "@/lib/utils"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "h-10 w-full min-w-0 rounded-xl border border-input/80 bg-muted/35 px-3.5 py-1 field-text shadow-[inset_0_2px_4px_-2px_rgba(0,0,0,0.18),inset_0_-1px_0_rgba(255,255,255,0.75),0_1px_0_rgba(255,255,255,0.55)] outline-none transition-[color,background-color,box-shadow,border-color] duration-150 ease-out file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:bg-background focus-visible:shadow-[inset_0_1px_2px_-1px_rgba(0,0,0,0.12),0_0_0_3px_color-mix(in_oklab,var(--ring)_35%,transparent),0_3px_8px_-4px_rgba(0,0,0,0.24)] disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30 dark:shadow-[inset_0_2px_4px_-2px_rgba(0,0,0,0.65),inset_0_-1px_0_rgba(255,255,255,0.06)] dark:focus-visible:bg-input/40 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
        className
      )}
      {...props}
    />
  )
}

export { Input }
