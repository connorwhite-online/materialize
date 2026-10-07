"use client"

import { Switch as SwitchPrimitive } from "@base-ui/react/switch"

import { cn } from "@/lib/utils"

function Switch({
  className,
  size = "default",
  ...props
}: SwitchPrimitive.Root.Props & {
  size?: "sm" | "default"
}) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      data-size={size}
      className={cn(
        // iOS/ChatGPT proportions: a round thumb riding a 2px inset track.
        "peer group/switch relative inline-flex shrink-0 cursor-pointer items-center rounded-full border border-transparent px-[2px] transition-[background-color,box-shadow] duration-200 outline-none after:absolute after:-inset-x-3 after:-inset-y-2 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 data-[size=default]:h-[22px] data-[size=default]:w-[38px] data-[size=sm]:h-[18px] data-[size=sm]:w-[30px] dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 data-checked:bg-primary data-unchecked:bg-foreground/15 data-disabled:cursor-not-allowed data-disabled:opacity-50",
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        // Round thumb; travel = track width − thumb − 2×2px inset − 2px border.
        className="pointer-events-none block rounded-full bg-white shadow-[0_1px_2px_rgb(0_0_0/0.2)] ring-0 transition-transform duration-200 ease-enter group-data-[size=default]/switch:size-[18px] group-data-[size=sm]/switch:size-[14px] group-data-[size=default]/switch:data-checked:translate-x-[16px] group-data-[size=default]/switch:data-unchecked:translate-x-0 group-data-[size=sm]/switch:data-checked:translate-x-[12px] group-data-[size=sm]/switch:data-unchecked:translate-x-0 dark:data-checked:bg-primary-foreground"
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
