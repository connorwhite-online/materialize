import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import {
  CheckCircle2Icon,
  CreditCardIcon,
  MailOpenIcon,
} from "lucide-react";
import { Factory } from "@/components/icons/factory";
import {
  pendingOrderHref,
  type PendingOrder,
  type PendingOrderStatus,
} from "@/lib/dashboard/pending-orders";

type StatusMeta = {
  label: string;
  Icon: LucideIcon | typeof Factory;
};

const PENDING_STATUS: Record<PendingOrderStatus, StatusMeta> = {
  awaiting_agent_approval: {
    label: "Awaiting Approval",
    Icon: MailOpenIcon,
  },
  auto_approved: {
    label: "Approved — Placing Soon",
    Icon: CheckCircle2Icon,
  },
  cart_created: {
    label: "Pending Payment",
    Icon: CreditCardIcon,
  },
  awaiting_production_payment: {
    label: "Awaiting production payment",
    Icon: Factory,
  },
};

export function PendingOrderTile({ order }: { order: PendingOrder }) {
  const total = order.totalPrice + order.serviceFee;
  const { label, Icon } = PENDING_STATUS[order.status] ?? {
    label: order.status,
    Icon: CreditCardIcon,
  };

  const meta = [
    order.vendorName,
    order.materialName,
    total > 0 ? `$${(total / 100).toFixed(2)}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <Link
      href={pendingOrderHref(order)}
      className="group flex w-52 shrink-0 flex-col gap-2 rounded-2xl border border-border bg-card p-3 transition-colors hover:border-primary/40"
    >
      <div className="flex items-center gap-2">
        <div
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-muted text-muted-foreground"
          aria-hidden
        >
          <Icon className="size-4" size={16} />
        </div>
        <p className="truncate text-xs font-medium text-muted-foreground">
          {label}
        </p>
      </div>
      <p className="truncate text-sm font-medium leading-tight group-hover:text-primary">
        {order.fileName ?? order.materialName ?? "3D Print"}
      </p>
      <p className="truncate text-xs text-muted-foreground">
        {meta || "Continue"}
      </p>
    </Link>
  );
}
