/** Floating nav chips (and matching surfaces like the Discover creator
 *  chips): a flat canvas fill on ChatGPT's hairline + short drop
 *  (`shadow-surface`), stepping to the muted fill on hover. No glow,
 *  no gradient — the chip should read as part of the page, not float
 *  above it. */
export const BUBBLE_SHADOW =
  "bg-background text-foreground shadow-surface transition-colors duration-150 hover:bg-muted";
