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
 * Renders nothing for an empty list. The header (title + count) is
 * supplied by the wrapping <CollapsibleSection> on the page —
 * this component only owns the row layout.
 */
export function BomDisplay({ items }: { items: BomDisplayItem[] }) {
  if (items.length === 0) return null;
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-muted/40 divide-y divide-border/60">
      {items.map((item) => (
        <BomRow key={item.id} item={item} />
      ))}
    </div>
  );
}

function BomRow({ item }: { item: BomDisplayItem }) {
  const qty = formatQuantity(item.quantity, item.unit);
  const inner = (
    <div className="flex items-baseline gap-4 px-4 py-3">
      <span className="shrink-0 font-mono text-xs text-muted-foreground tabular-nums">
        {qty}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium">
          {item.name}
          {item.sourceUrl && (
            <span className="ml-1 text-xs text-muted-foreground">↗</span>
          )}
        </p>
        {item.notes && (
          <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">
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
        className="block transition-colors hover:bg-muted/60"
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
