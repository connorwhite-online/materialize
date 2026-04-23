"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useUser } from "@clerk/nextjs";
import { TrashIcon, MinusIcon, PlusIcon } from "lucide-react";
import { ChevronDown } from "@/components/icons/chevron-down";
import { ChevronUp } from "@/components/icons/chevron-up";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { useCart, type LocalCartItem } from "./cart-context";
import { useAuthModal } from "@/components/auth/auth-modal";
import type { CartItemWithMeta } from "@/app/actions/cart";
import { checkoutVendorGroup } from "@/app/actions/print";
import { dedupeShippingByShipId } from "@/lib/pricing/shipping";

const SERVICE_FEE_RATE = 0.03;
const STALE_QUOTE_AGE_MS = 2 * 60 * 60 * 1000;

type DisplayItem = {
  id: string;
  isLocal: boolean;
  fileName: string | null;
  originalFilename: string;
  vendorId: string;
  vendorName: string | null;
  shippingId: string;
  quantity: number;
  materialPrice: number;
  shippingPrice: number;
  staleQuote: boolean;
};

function toDisplayItems(
  dbItems: CartItemWithMeta[],
  localItems: LocalCartItem[]
): DisplayItem[] {
  const now = Date.now();
  return [
    ...dbItems.map<DisplayItem>((i) => ({
      id: i.id,
      isLocal: false,
      fileName: i.fileName,
      originalFilename: i.originalFilename,
      vendorId: i.vendorId,
      vendorName: i.vendorName,
      shippingId: i.shippingId,
      quantity: i.quantity,
      materialPrice: i.materialPrice,
      shippingPrice: i.shippingPrice,
      staleQuote: now - new Date(i.updatedAt).getTime() > STALE_QUOTE_AGE_MS,
    })),
    ...localItems.map<DisplayItem>((i) => ({
      id: i.localId,
      isLocal: true,
      fileName: null,
      originalFilename: i.originalFilename,
      vendorId: i.vendorId,
      vendorName: i.vendorName ?? null,
      shippingId: i.shippingId,
      quantity: i.quantity,
      materialPrice: Math.round(i.materialPrice * 100),
      shippingPrice: Math.round(i.shippingPrice * 100),
      staleQuote: false,
    })),
  ];
}

function groupMaterial(items: DisplayItem[]): number {
  return items.reduce((sum, i) => sum + i.materialPrice * i.quantity, 0);
}

function groupShipping(items: DisplayItem[]): number {
  return dedupeShippingByShipId(items);
}

/**
 * Uncommitted print the user is actively configuring — when its
 * vendor id matches an existing slot, the stack renders a dashed
 * preview row inside that slot + highlights the slot with a ring,
 * making the "this will merge into your Unionfab cart" intent
 * obvious before the user hits Add to Cart.
 *
 * Prices are in cents (line totals — material × quantity and
 * deduped shipping), matching the committed DisplayItem model so
 * the preview sits alongside committed rows without conversion.
 */
export interface PendingItem {
  vendorId: string;
  filename: string;
  quantity: number;
  /** Cents, unit price (multiply by quantity for line total). */
  materialPrice: number;
}

interface CartSlotStackProps {
  /**
   * Vendor id whose slot should be expanded by default. The user
   * just added to this vendor group, so opening it surfaces the new
   * line item + lets them hit Checkout without a second click.
   *
   * Null/undefined collapses every slot — used in the "configuring"
   * state where the active session's PriceDisplay is already
   * showing the in-progress totals above the stack.
   */
  expandedVendorId?: string | null;
  /**
   * Hide the slot for this vendor — used in the "configuring" state
   * where the PriceDisplay above the stack is already showing the
   * same vendor's in-progress totals, and we don't want a
   * duplicated view of the just-added line.
   */
  hideVendorId?: string | null;
  /**
   * In-progress print the user is currently configuring. If its
   * vendorId matches an existing slot, that slot auto-expands and
   * shows a dashed "pending" preview row above its committed
   * items. If no existing slot matches, the pending item is
   * ignored here — the separate Order Summary above the stack is
   * already showing the same info.
   */
  pendingItem?: PendingItem | null;
}

/**
 * Stack of per-vendor cart containers shown on the right column of
 * /print after the user adds something to cart (or while they
 * configure a subsequent print). Each slot collapses to a one-line
 * summary (vendor + count + total) and expands to the line items
 * with its own Checkout button.
 */
export function CartSlotStack({
  expandedVendorId,
  hideVendorId,
  pendingItem,
}: CartSlotStackProps) {
  const cart = useCart();

  // CartProvider only fetches item details when the modal panel is
  // opened; before that, `items` is empty and we'd render nothing.
  // Kick a one-shot refresh on mount so existing vendor groups
  // surface in the stack as soon as it appears inline on /print.
  const didRefreshRef = useRef(false);
  useEffect(() => {
    if (!cart || didRefreshRef.current) return;
    didRefreshRef.current = true;
    cart.refresh();
  }, [cart]);

  const vendorGroups = useMemo(() => {
    if (!cart) return [];
    const all = toDisplayItems(cart.items, cart.localItems);
    const groups = new Map<
      string,
      { vendorId: string; vendorName: string | null; items: DisplayItem[] }
    >();
    for (const item of all) {
      const existing = groups.get(item.vendorId);
      if (existing) {
        existing.items.push(item);
        if (!existing.vendorName && item.vendorName) {
          existing.vendorName = item.vendorName;
        }
      } else {
        groups.set(item.vendorId, {
          vendorId: item.vendorId,
          vendorName: item.vendorName,
          items: [item],
        });
      }
    }
    return Array.from(groups.values());
  }, [cart]);

  const visibleGroups = hideVendorId
    ? vendorGroups.filter((g) => g.vendorId !== hideVendorId)
    : vendorGroups;

  if (!cart || visibleGroups.length === 0) return null;

  // A pending item only visually attaches when there's an existing
  // slot to merge into — otherwise the in-progress Order Summary
  // above the stack is the canonical preview for the would-be new
  // vendor group.
  const pendingMatchesExisting =
    !!pendingItem &&
    visibleGroups.some((g) => g.vendorId === pendingItem.vendorId);

  return (
    <div className="space-y-3">
      <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
        Your carts
      </p>
      {visibleGroups.map((group) => {
        const hasPending =
          pendingMatchesExisting &&
          pendingItem?.vendorId === group.vendorId;
        return (
          <CartSlot
            key={group.vendorId}
            group={group}
            defaultExpanded={
              hasPending || group.vendorId === expandedVendorId
            }
            pendingItem={hasPending ? pendingItem : null}
          />
        );
      })}
    </div>
  );
}

function CartSlot({
  group,
  defaultExpanded,
  pendingItem,
}: {
  group: { vendorId: string; vendorName: string | null; items: DisplayItem[] };
  defaultExpanded: boolean;
  pendingItem: PendingItem | null;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  // Re-sync when the defaultExpanded signal changes — e.g. user
  // adds to a different vendor, which bumps expandedVendorId in the
  // parent. Without this the slot would stay in whatever state it
  // was manually toggled to.
  const lastDefaultRef = useRef(defaultExpanded);
  useEffect(() => {
    if (defaultExpanded !== lastDefaultRef.current) {
      setExpanded(defaultExpanded);
      lastDefaultRef.current = defaultExpanded;
    }
  }, [defaultExpanded]);

  const cart = useCart();
  const router = useRouter();
  const { isSignedIn } = useUser();
  const { openAuth } = useAuthModal();
  const [error, setError] = useState<string | null>(null);
  const [checkingOut, setCheckingOut] = useState(false);
  const checkingOutRef = useRef(false);

  const material = groupMaterial(group.items);
  const shipping = groupShipping(group.items);
  // Service fee is 3% of material (+ production fee, which we
  // don't track client-side for cart rows — server recomputes at
  // checkout-time with the real number). Keep shipping out of the
  // base so freight doesn't scale our cut.
  const serviceFee = Math.round(material * SERVICE_FEE_RATE);
  const total = material + serviceFee + shipping;
  const itemCount = group.items.reduce((sum, i) => sum + i.quantity, 0);

  const handleCheckout = async () => {
    if (!cart) return;
    setError(null);

    if (!isSignedIn) {
      openAuth("sign-up");
      return;
    }

    if (checkingOutRef.current) return;
    checkingOutRef.current = true;
    setCheckingOut(true);
    try {
      if (cart.localItems.length > 0) {
        const result = await cart.materializeLocalItems();
        if (!result.ok) {
          setError(result.error ?? "Failed to prepare cart items");
          return;
        }
      }

      const result = await checkoutVendorGroup(group.vendorId);
      if ("error" in result) {
        setError(result.error);
        return;
      }
      router.push(`/checkout/${result.orderId}`);
    } finally {
      setCheckingOut(false);
      checkingOutRef.current = false;
    }
  };

  const handleRemove = (item: DisplayItem) => {
    if (!cart) return;
    if (item.isLocal) cart.removeLocalItem(item.id);
    else cart.removeItem(item.id);
  };

  const handleUpdateQty = (item: DisplayItem, qty: number) => {
    if (!cart) return;
    if (item.isLocal) cart.updateLocalItemQuantity(item.id, qty);
    else cart.updateQuantity(item.id, qty);
  };

  return (
    <div
      className={`rounded-xl border bg-card ${
        pendingItem
          ? "border-primary ring-2 ring-primary/20"
          : "border-border"
      }`}
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-3 text-left"
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-medium">
              {group.vendorName ?? group.vendorId}
            </p>
            {pendingItem && (
              <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-primary">
                + 1 pending
              </span>
            )}
          </div>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {itemCount} {itemCount === 1 ? "item" : "items"} · $
            {(total / 100).toFixed(2)}
          </p>
        </div>
        {expanded ? (
          <ChevronUp className="shrink-0 text-muted-foreground" />
        ) : (
          <ChevronDown className="shrink-0 text-muted-foreground" />
        )}
      </button>

      {expanded && (
        <div className="border-t border-border px-4 py-3 space-y-3">
          {pendingItem && (
            <div className="flex items-start gap-2 rounded-lg border border-dashed border-primary/40 bg-primary/5 px-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {pendingItem.filename}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  ${(pendingItem.materialPrice / 100).toFixed(2)} each ·
                  will merge on Add to Cart
                </p>
              </div>
              <span className="text-sm font-medium tabular-nums">
                ×{pendingItem.quantity}
              </span>
              <span className="w-16 shrink-0 text-right text-sm font-medium tabular-nums">
                $
                {(
                  (pendingItem.materialPrice * pendingItem.quantity) /
                  100
                ).toFixed(2)}
              </span>
            </div>
          )}

          {group.items.map((item) => (
            <div key={item.id} className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {item.fileName ?? item.originalFilename}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  ${(item.materialPrice / 100).toFixed(2)} each
                </p>
                {item.staleQuote && (
                  <p className="mt-0.5 text-[10px] text-amber-700 dark:text-amber-300">
                    Quote may have expired — re-add if checkout fails.
                  </p>
                )}
              </div>

              <div className="flex items-center gap-1">
                <button
                  onClick={() =>
                    item.quantity > 1 &&
                    handleUpdateQty(item, item.quantity - 1)
                  }
                  disabled={item.quantity <= 1}
                  className="rounded p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors"
                >
                  <MinusIcon className="h-3.5 w-3.5" />
                </button>
                <span className="w-6 text-center text-sm tabular-nums">
                  {item.quantity}
                </span>
                <button
                  onClick={() =>
                    item.quantity < 100 &&
                    handleUpdateQty(item, item.quantity + 1)
                  }
                  disabled={item.quantity >= 100}
                  className="rounded p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors"
                >
                  <PlusIcon className="h-3.5 w-3.5" />
                </button>
              </div>

              <button
                onClick={() => handleRemove(item)}
                className="rounded p-0.5 text-muted-foreground hover:text-destructive transition-colors"
              >
                <TrashIcon className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}

          <Separator />

          <div className="space-y-1 text-sm">
            <div className="flex justify-between text-muted-foreground">
              <span>Material</span>
              <span>${(material / 100).toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-muted-foreground">
              <span>Service fee (3%)</span>
              <span>${(serviceFee / 100).toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-muted-foreground">
              <span>Shipping</span>
              <span>${(shipping / 100).toFixed(2)}</span>
            </div>
            <div className="flex justify-between font-semibold">
              <span>Total</span>
              <span>${(total / 100).toFixed(2)}</span>
            </div>
          </div>

          {error && (
            <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              {error}
            </p>
          )}

          <Button
            onClick={handleCheckout}
            disabled={checkingOut || cart?.materializing}
            className="w-full"
            size="sm"
          >
            {cart?.materializing
              ? "Preparing files..."
              : checkingOut
                ? "Processing..."
                : !isSignedIn
                  ? "Sign up to checkout"
                  : "Checkout"}
          </Button>
        </div>
      )}
    </div>
  );
}
