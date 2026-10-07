import { Print } from "@/components/icons/print";

/**
 * 36px leading tile for an order row: the material's colour as a flat
 * fill when we know it, otherwise the print glyph on gray.
 */
export function MaterialSwatch({ color }: { color: string | null }) {
  if (!color) {
    return (
      <span
        aria-hidden="true"
        className="flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-muted text-muted-foreground [&_svg]:size-[18px]"
      >
        <Print />
      </span>
    );
  }
  return (
    <span
      aria-hidden="true"
      className="size-9 shrink-0 rounded-[10px] ring-1 ring-border ring-inset"
      style={{ backgroundColor: color }}
    />
  );
}
