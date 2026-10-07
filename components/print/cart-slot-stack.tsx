"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useUser } from "@clerk/nextjs";
import { ChevronDown } from "@/components/icons/chevron-down";
import { Button } from "@/components/ui/button";
import { FormActions } from "@/components/ui/field";
import { SummaryRow } from "@/components/ui/summary-list";
import { cn } from "@/lib/utils";
import { CartLineRow } from "./cart-line-row";
import { useCart, type LocalCartItem } from "./cart-context";
import { useAuthModal } from "@/components/auth/auth-modal";
import type { CartItemWithMeta } from "@/app/actions/cart";
import { checkoutVendorGroup } from "@/app/actions/print";
import { dedupeShippingByShipId } from "@/lib/pricing/shipping";
import { calcServiceFee } from "@/lib/fees";
import type { CheckoutModel } from "@/lib/env";

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

/**
 * Money value that becomes a pulse skeleton while the vendor group
 * has a line re-quoting after a quantity change — avoids flashing a
 * stale flat-multiplied subtotal.
 */
function SlotPriceCell({ cents, pending }: { cents: number; pending: boolean }) {
  if (pending) {
    return <span className="inline-block h-3.5 w-12 animate-pulse rounded bg-muted" />;
  }
  return <>${(cents / 100).toFixed(2)}</>;
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
  /**
   * Which checkout architecture governs the fee-clamp math (see
   * lib/fees.ts). Defaults to "single" (no clamp) — callers that
   * know the real `getCheckoutModel()` value (server-derived, see
   * AGENTS.md) should thread it down; until they do, this matches
   * the pre-existing behavior of this component.
   */
  checkoutModel?: CheckoutModel;
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
  checkoutModel = "single",
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
    <section className="flex flex-col gap-2">
      <h2 className="text-sm leading-5 font-semibold">Your carts</h2>
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
            checkoutModel={checkoutModel}
          />
        );
      })}
    </section>
  );
}

function CartSlot({
  group,
  defaultExpanded,
  pendingItem,
  checkoutModel,
}: {
  group: { vendorId: string; vendorName: string | null; items: DisplayItem[] };
  defaultExpanded: boolean;
  pendingItem: PendingItem | null;
  checkoutModel: CheckoutModel;
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

  const groupRepricing = group.items.some((i) => cart?.repricingIds.has(i.id));
  const material = groupMaterial(group.items);
  const shipping = groupShipping(group.items);
  // Service fee is 3% of material (+ production fee, which we
  // don't track client-side for cart rows — server recomputes at
  // checkout-time with the real number). Keep shipping out of the
  // base so freight doesn't scale our cut. Single-sourced from
  // lib/fees.ts so this can't drift from the server's clamp math.
  const serviceFee = calcServiceFee(material, checkoutModel);
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

  // DB cart items re-quote server-side on a quantity change; a failed
  // re-quote is REJECTED (not silently committed with a stale quote —
  // MONEY-1), so surface it in the same error banner checkout errors
  // use. Local (anon, pre-materialize) items are plain client state
  // and never hit this path.
  const handleUpdateQty = async (item: DisplayItem, qty: number) => {
    if (!cart) return;
    if (item.isLocal) {
      cart.updateLocalItemQuantity(item.id, qty);
      return;
    }
    const result = await cart.updateQuantity(item.id, qty);
    if (!result.ok) {
      setError(result.error);
    }
  };

  return (
    <div
      className={cn(
        "overflow-hidden rounded-2xl bg-card ring-1 transition-shadow duration-150",
        pendingItem ? "ring-foreground/25" : "ring-border"
      )}
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="flex w-full cursor-pointer items-center gap-3 px-4 py-3 text-left transition-colors duration-150 hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none"
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm leading-5 font-medium">
              {group.vendorName ?? group.vendorId}
            </p>
            {pendingItem && (
              <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                +1 adding
              </span>
            )}
          </div>
          <p className="text-[13px] leading-[18px] text-muted-foreground tabular-nums">
            {itemCount} {itemCount === 1 ? "item" : "items"} · $
            {(total / 100).toFixed(2)}
          </p>
        </div>
        <ChevronDown
          aria-hidden="true"
          className={cn(
            "shrink-0 text-muted-foreground transition-transform duration-150",
            expanded && "rotate-180"
          )}
        />
      </button>

      {expanded && (
        <div className="border-t border-border px-4 pt-1 pb-4">
          {pendingItem && (
            <div className="-mx-2 mt-2 flex items-center gap-3 rounded-xl bg-muted/60 px-2 py-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm leading-5 font-medium">
                  {pendingItem.filename}
                </p>
                <p className="text-[13px] leading-[18px] text-muted-foreground">
                  Joins this cart when you add it
                </p>
              </div>
              <span className="text-[13px] text-muted-foreground tabular-nums">
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

          <div className="flex flex-col">
            {group.items.map((item) => (
              <CartLineRow
                key={item.id}
                name={item.fileName ?? item.originalFilename}
                quantity={item.quantity}
                unitCents={item.materialPrice}
                repricing={!!cart?.repricingIds.has(item.id)}
                stale={item.staleQuote}
                onUpdateQty={(qty) => handleUpdateQty(item, qty)}
                onRemove={() => handleRemove(item)}
              />
            ))}
          </div>

          <dl className="mt-2 flex flex-col gap-1.5 border-t border-border pt-3 text-sm">
            <SummaryRow
              label="Material"
              value={<SlotPriceCell cents={material} pending={groupRepricing} />}
            />
            <SummaryRow
              label="Service fee (3%)"
              value={<SlotPriceCell cents={serviceFee} pending={groupRepricing} />}
            />
            <SummaryRow label="Shipping" value={`$${(shipping / 100).toFixed(2)}`} />
            <SummaryRow
              total
              label="Total"
              value={<SlotPriceCell cents={total} pending={groupRepricing} />}
            />
          </dl>

          {error && (
            <p
              role="alert"
              className="mt-3 rounded-xl bg-destructive/10 px-3 py-2 text-[13px] leading-[18px] text-destructive"
            >
              {error}
            </p>
          )}

          <FormActions className="mt-3">
            <Button
              onClick={handleCheckout}
              loading={checkingOut || !!cart?.materializing}
            >
              {cart?.materializing
                ? "Preparing files…"
                : !isSignedIn
                  ? "Sign up to check out"
                  : "Check out"}
            </Button>
          </FormActions>
        </div>
      )}
    </div>
  );
}
