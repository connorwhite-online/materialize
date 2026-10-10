import Image from "next/image";
import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import {
  BoxIcon,
  CheckCircle2Icon,
  CircleAlertIcon,
  CreditCardIcon,
  MailOpenIcon,
  PackageCheckIcon,
  TruckIcon,
} from "lucide-react";
import { Factory } from "@/components/icons/factory";
import { isSessionGatedImageSrc } from "@/lib/images/session-gated-src";
import { cn } from "@/lib/utils";
import {
  formatOrderDate,
  formatOrderFileCount,
  formatOrderTotal,
  orderNeedsAttention,
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

/** Thumbnail well: the part's captured preview, or a box glyph. */
function PartThumb({ order }: { order: PendingOrder }) {
  const extra = order.fileCount - 1;
  return (
    <div className="relative size-11 shrink-0" aria-hidden>
      <div className="flex size-full items-center justify-center overflow-hidden rounded-lg border border-border bg-muted text-muted-foreground">
        {order.thumbnailUrl ? (
          <Image
            src={order.thumbnailUrl}
            alt=""
            width={44}
            height={44}
            unoptimized={isSessionGatedImageSrc(order.thumbnailUrl)}
            // A few KB each, at most a dozen, and the carousel's
            // overflow keeps lazy-loading from ever firing for them.
            loading="eager"
            className="size-full scale-125 object-contain"
          />
        ) : (
          <BoxIcon className="size-4" size={16} strokeWidth={1.75} />
        )}
      </div>
      {extra > 0 ? (
        <span className="absolute -right-1.5 -bottom-1.5 rounded-full border border-border bg-card px-1 text-[10px] font-medium leading-4 text-foreground tabular-nums">
          +{extra}
        </span>
      ) : null}
    </div>
  );
}

export function PendingOrderTile({ order }: { order: PendingOrder }) {
  const { label, Icon } = PENDING_STATUS[order.status] ?? {
    label: order.status,
    Icon: CreditCardIcon,
  };
  const attention = orderNeedsAttention(order.status);
  const date = formatOrderDate(order.createdAt);
  const total = formatOrderTotal(order.totalCents);

  const title = order.title ?? formatOrderFileCount(order.fileCount);
  // Material when the catalog answered, else the file count / date —
  // the line is never empty, and the date is always on the tooltip.
  // Extra files already show as the thumbnail's +N badge.
  const material = [order.materialName, order.materialColor]
    .filter(Boolean)
    .join(" · ");
  const meta =
    material ||
    [order.title && order.fileCount > 1 ? formatOrderFileCount(order.fileCount) : null, date]
      .filter(Boolean)
      .join(" · ");
  const qty = order.quantity > 1 ? `×${order.quantity}` : null;

  return (
    <Link
      href={pendingOrderHref(order)}
      title={date ? `Ordered ${date}` : undefined}
      className="group flex w-52 shrink-0 flex-col gap-2.5 rounded-2xl border border-border bg-card p-3 transition-colors hover:border-primary/40"
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <PartThumb order={order} />
        <div className="min-w-0 space-y-0.5">
          <p className="truncate text-sm font-medium leading-tight group-hover:text-primary">
            {title}
          </p>
          {meta ? (
            <p className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
              {material && order.materialSwatch ? (
                <span
                  aria-hidden
                  className="size-2 shrink-0 rounded-full ring-1 ring-border"
                  style={{ background: order.materialSwatch }}
                />
              ) : null}
              <span className="truncate">{meta}</span>
            </p>
          ) : null}
        </div>
      </div>
      <div className="flex items-center justify-between gap-2">
        <span
          className={cn(
            "inline-flex min-w-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium",
            attention
              ? "bg-primary text-primary-foreground"
              : "bg-muted text-muted-foreground"
          )}
        >
          <Icon className="size-3 shrink-0" size={12} />
          <span className="truncate">{label}</span>
        </span>
        {total || qty ? (
          <span className="shrink-0 text-xs tabular-nums">
            {qty ? <span className="text-muted-foreground">{qty} </span> : null}
            {total ? <span className="font-medium">{total}</span> : null}
          </span>
        ) : null}
      </div>
    </Link>
  );
}
