import type * as React from "react";

/**
 * Spec sheet for a listing's sidebar (file and project detail): label
 * left, value right, hairlines between, no box. Replaced a scatter of
 * one-off lines (filename, a mono "Bounding box", a category pill, a
 * license pill marooned at the foot of the page) with one scannable
 * list in the decision column.
 */
export function DetailList({ children }: { children: React.ReactNode }) {
  return (
    <dl className="flex flex-col border-t border-border text-sm">{children}</dl>
  );
}

export function DetailRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-11 items-center justify-between gap-4 border-b border-border py-2.5">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="flex min-w-0 items-center justify-end gap-2 text-right">
        {children}
      </dd>
    </div>
  );
}

/** 25 → "25", 10.04 → "10", 12.5 → "12.5": no trailing ".0" noise. */
export function formatMm(n: number) {
  return Number(n.toFixed(1)).toString();
}
