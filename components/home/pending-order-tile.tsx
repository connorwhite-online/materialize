import Link from "next/link";
import { getMaterialById } from "@/lib/materials";
import {
  pendingOrderHref,
  type PendingOrder,
} from "@/lib/dashboard/pending-orders";

const PENDING_LABELS: Record<string, string> = {
  awaiting_agent_approval: "Awaiting Approval",
  auto_approved: "Approved — Placing Soon",
  cart_created: "Pending Payment",
  awaiting_production_payment: "Awaiting production payment",
};

export function PendingOrderTile({ order }: { order: PendingOrder }) {
  const materialMeta = order.material
    ? getMaterialById(order.material)
    : null;
  const total = order.totalPrice + order.serviceFee;
  const label = PENDING_LABELS[order.status] || order.status;

  return (
    <Link
      href={pendingOrderHref(order)}
      className="group flex w-52 shrink-0 flex-col gap-2 rounded-2xl border border-border bg-card p-3 transition-colors hover:border-primary/40"
    >
      <div className="flex items-center gap-2">
        {materialMeta?.color ? (
          <div
            className="h-8 w-8 shrink-0 rounded-md border border-border"
            style={{
              background: `linear-gradient(135deg, ${materialMeta.color}, ${materialMeta.color}dd)`,
            }}
          />
        ) : (
          <div className="h-8 w-8 shrink-0 rounded-md border border-border bg-muted" />
        )}
        <p className="truncate text-xs font-medium text-muted-foreground">
          {label}
        </p>
      </div>
      <p className="truncate text-sm font-medium leading-tight group-hover:text-primary">
        {order.fileName ?? materialMeta?.name ?? "3D Print"}
      </p>
      <p className="truncate text-xs text-muted-foreground">
        {order.vendorName ? `${order.vendorName} · ` : ""}
        {total > 0 ? `$${(total / 100).toFixed(2)}` : "Continue"}
      </p>
    </Link>
  );
}
