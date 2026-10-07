import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import {
  CheckCircle2Icon,
  CircleAlertIcon,
  CreditCardIcon,
  MailOpenIcon,
  PackageCheckIcon,
  TruckIcon,
} from "lucide-react";
import { Factory } from "@/components/icons/factory";
import { ChevronRight } from "@/components/icons/chevron-right";
import {
  formatOrderDate,
  formatOrderFileCount,
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
  ordered: {
    label: "Order placed",
    Icon: PackageCheckIcon,
  },
  in_production: {
    label: "Printing",
    Icon: Factory,
  },
  shipped: {
    label: "Shipped",
    Icon: TruckIcon,
  },
  blocked: {
    label: "On hold",
    Icon: CircleAlertIcon,
  },
};

/**
 * One in-progress order on the authed home, as a list row (rulebook §
 * Lists): icon badge, what it is, where it stands, chevron. It used to
 * be a 208px bordered tile in a sideways carousel, which hid the second
 * and third order off-screen exactly when they needed attention.
 */
export function PendingOrderTile({ order }: { order: PendingOrder }) {
  const { label, Icon } = PENDING_STATUS[order.status] ?? {
    label: order.status,
    Icon: CreditCardIcon,
  };
  const needsAction = ACTION_STATUSES.has(order.status);
  const dateLine = formatOrderDate(order.createdAt);

  return (
    <Link
      href={pendingOrderHref(order)}
      className="group -mx-3 flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors duration-150 hover:bg-muted/70 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      <span
        aria-hidden
        className="flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-muted text-foreground"
      >
        <Icon className="size-[18px]" size={18} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm leading-5 font-medium">
          {formatOrderFileCount(order.fileCount)}
        </span>
        <span
          className={
            needsAction
              ? "block truncate text-[13px] leading-[18px] text-warning"
              : "block truncate text-[13px] leading-[18px] text-muted-foreground"
          }
        >
          {label}
        </span>
      </span>
      {dateLine ? (
        <span className="shrink-0 text-[13px] text-subtle-foreground tabular-nums">
          {dateLine}
        </span>
      ) : null}
      <ChevronRight
        size={14}
        className="shrink-0 text-subtle-foreground transition-colors group-hover:text-foreground"
      />
    </Link>
  );
}

/** Statuses where the buyer has to do something next. */
const ACTION_STATUSES = new Set<PendingOrderStatus>([
  "awaiting_agent_approval",
  "cart_created",
  "awaiting_production_payment",
  "blocked",
]);
