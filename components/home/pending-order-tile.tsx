import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import {
  CheckCircle2Icon,
  CreditCardIcon,
  MailOpenIcon,
} from "lucide-react";
import { Factory } from "@/components/icons/factory";
import {
  formatOrderFileLine,
  formatOrderMaterialLine,
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
    label: "Confirm order",
    Icon: MailOpenIcon,
  },
  auto_approved: {
    label: "Placing soon",
    Icon: CheckCircle2Icon,
  },
  cart_created: {
    label: "Pending payment",
    Icon: CreditCardIcon,
  },
  awaiting_production_payment: {
    label: "Complete payment",
    Icon: Factory,
  },
};

export function PendingOrderTile({ order }: { order: PendingOrder }) {
  const { label, Icon } = PENDING_STATUS[order.status] ?? {
    label: order.status,
    Icon: CreditCardIcon,
  };

  const fileLine = formatOrderFileLine(order.fileCount, order.fileName);
  const materialLine = formatOrderMaterialLine(
    order.materialCount,
    order.materialName
  );

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
      <div className="min-w-0 space-y-0.5">
        <p className="truncate text-sm font-medium leading-tight group-hover:text-primary">
          {fileLine}
        </p>
        {materialLine ? (
          <p className="truncate text-xs text-muted-foreground">
            {materialLine}
          </p>
        ) : null}
      </div>
    </Link>
  );
}
