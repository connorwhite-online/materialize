export type BomDisplayItem = {
  id: string;
  name: string;
  quantity: number;
  unit: string | null;
  notes: string | null;
  sourceUrl: string | null;
};

/**
 * Read-only Bill of Materials list on the project detail page.
 * Renders nothing for an empty list. Hairline rows with the quantity
 * in a soft chip first, so "how many" scans down one column.
 */
export function BomDisplay({ items }: { items: BomDisplayItem[] }) {
  if (items.length === 0) return null;
  return (
    <div className="divide-y divide-border border-y border-border">
      {items.map((item) => (
        <BomRow key={item.id} item={item} />
      ))}
    </div>
  );
}

function BomRow({ item }: { item: BomDisplayItem }) {
  const qty = formatQuantity(item.quantity, item.unit);
  const inner = (
    <div className="flex items-center gap-3 py-2.5">
      <span className="flex h-7 min-w-10 shrink-0 items-center justify-center rounded-lg bg-muted px-2 text-[13px] font-medium tabular-nums">
        {qty}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-sm leading-5 font-medium underline-offset-4 group-hover:underline">
          {item.name}
          {item.sourceUrl && (
            <span aria-hidden className="ml-1 text-xs text-muted-foreground">↗</span>
          )}
        </p>
        {item.notes && (
          <p className="text-[13px] leading-[18px] text-muted-foreground line-clamp-2">
            {item.notes}
          </p>
        )}
      </div>
    </div>
  );
  if (item.sourceUrl) {
    return (
      <a
        href={item.sourceUrl}
        target="_blank"
        rel="noreferrer noopener"
        className="group block"
      >
        {inner}
      </a>
    );
  }
  return inner;
}

function formatQuantity(quantity: number, unit: string | null): string {
  // Drop trailing zeros for whole values: "1" not "1.000".
  const num = Number.isInteger(quantity)
    ? String(quantity)
    : quantity
        .toFixed(3)
        .replace(/\.?0+$/, "");
  return unit ? `${num} ${unit}` : num;
}
