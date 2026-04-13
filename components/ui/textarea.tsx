import * as React from "react"

import { cn } from "@/lib/utils"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "depth-sunken flex field-sizing-content min-h-24 w-full resize-none rounded-xl border border-input bg-muted/70 px-3.5 py-2.5 text-base outline-none transition-shadow duration-200 ease-out placeholder:text-muted-foreground focus-visible:shadow-[var(--shadow-sunken),var(--shadow-focus-ring)] disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/40 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
