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

function ThumbImage({ src }: { src: string | null }) {
  return src ? (
    <Image
      src={src}
      alt=""
      width={56}
      height={56}
      unoptimized={isSessionGatedImageSrc(src)}
      // A few KB each, at most a few dozen, and the carousel's overflow
      // keeps lazy-loading from ever firing for them.
      loading="eager"
      className="size-full scale-125 object-contain"
    />
  ) : (
    <BoxIcon className="size-4 text-muted-foreground" size={16} strokeWidth={1.75} />
  );
}

const THUMB_TILE =
  "flex items-center justify-center overflow-hidden rounded-lg border border-border bg-muted";

/**
 * The part's captured preview. A multi-file order fans up to three of
 * its parts as a little deck — the same stack a project card uses — so
 * the card reads as "several things" before you read the count.
 */
function PartThumb({ order }: { order: PendingOrder }) {
  const stack = order.fileCount > 1;
  if (!stack) {
    return (
      <div className={cn(THUMB_TILE, "size-14 shrink-0")} aria-hidden>
        <ThumbImage src={order.thumbnailUrl} />
      </div>
    );
  }
  const shown = Math.min(order.fileCount, 3);
  const layers = Array.from({ length: shown }, (_, i) => ({
    i,
    src: order.thumbnails[i] ?? null,
  })).reverse();
  const extra = order.fileCount - shown;
  return (
    <div className="relative size-14 shrink-0" aria-hidden>
      {layers.map(({ i, src }) => (
        <div
          key={i}
          className={cn(THUMB_TILE, "absolute inset-1.5 shadow-sm")}
          style={{
            transform: `translate(${i === 0 ? 0 : i === 1 ? -7 : 7}px, ${i === 0 ? 0 : 2}px) rotate(${i === 0 ? 0 : i === 1 ? -11 : 11}deg) scale(${1 - i * 0.05})`,
            zIndex: shown - i,
          }}
        >
          <ThumbImage src={src} />
        </div>
      ))}
      {extra > 0 ? (
        <span className="absolute -right-1.5 -bottom-1 z-10 rounded-full border border-border bg-card px-1 text-[10px] font-medium leading-4 text-foreground tabular-nums">
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
  // A multi-file card names its lead part and says how many more.
  const titleLine =
    order.title && order.fileCount > 1
      ? `${title} + ${order.fileCount - 1} more`
      : title;
  const qty = order.quantity > 1 ? `×${order.quantity}` : null;

  return (
    <Link
      href={pendingOrderHref(order)}
      title={date ? `Ordered ${date}` : undefined}
      className="group flex w-64 shrink-0 flex-col gap-2.5 rounded-2xl border border-border bg-card p-3 transition-colors hover:border-primary/40"
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <PartThumb order={order} />
        <div className="min-w-0 space-y-0.5">
          <p className="truncate text-sm font-medium leading-tight group-hover:text-primary">
            {titleLine}
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
