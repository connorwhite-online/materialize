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
    <div className="overflow-hidden rounded-xl border border-border divide-y divide-border/60">
      {items.map((item) => (
        <BomRow key={item.id} item={item} />
      ))}
    </div>
  );
}

function BomRow({ item }: { item: BomDisplayItem }) {
  const qty = formatQuantity(item.quantity, item.unit);
  return (
    <div className="flex items-start gap-4 px-4 py-3">
      <span className="w-20 shrink-0 font-mono text-xs text-muted-foreground tabular-nums">
        {qty}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium">
          {item.sourceUrl ? (
            <a
              href={item.sourceUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="hover:underline"
            >
              {item.name}
              <span className="ml-1 text-xs text-muted-foreground">↗</span>
            </a>
          ) : (
            item.name
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
