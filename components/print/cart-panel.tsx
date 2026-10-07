"use client";

import { DottedSpinner } from "@/components/icons/dotted-spinner";
import { useMemo, useRef, useState } from "react";
import { useUser } from "@clerk/nextjs";
import { useCart, type LocalCartItem } from "./cart-context";
import type { CartItemWithMeta } from "@/app/actions/cart";
import { useAuthModal } from "@/components/auth/auth-modal";
import { Button } from "@/components/ui/button";
import { SummaryRow } from "@/components/ui/summary-list";
import { X } from "@/components/icons/x";
import { CartLineRow } from "./cart-line-row";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { checkoutVendorGroup } from "@/app/actions/print";
import { dedupeShippingByShipId } from "@/lib/pricing/shipping";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { calcServiceFee } from "@/lib/fees";
import type { CheckoutModel } from "@/lib/env";
import { SandboxBadge } from "@/components/sandbox-badge";
import { useSandbox } from "@/components/sandbox-context";

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
  /** True when the underlying quote is old enough to be at risk of
   * having expired on CraftCloud's side (DB rows only — local
   * items are always fresh since they live for one browser session). */
  staleQuote: boolean;
};

// CraftCloud's quote TTLs aren't documented but anecdotally they're
// a few hours. Flag rows older than this as "at risk" so users get
// a heads-up to refresh before the checkout error surfaces. Soft
// warning only — checkout still attempts and the server returns a
// more specific message if the quote actually is gone.
const STALE_QUOTE_AGE_MS = 2 * 60 * 60 * 1000;

function toDisplayItems(
  dbItems: CartItemWithMeta[],
  localItems: LocalCartItem[]
): DisplayItem[] {
  const now = Date.now();
  const fromDb: DisplayItem[] = dbItems.map((i) => ({
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
  }));
  const fromLocal: DisplayItem[] = localItems.map((i) => ({
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
  }));
  return [...fromDb, ...fromLocal];
}

/**
 * Per-vendor-group material total (cents) — service fee is 3% of
 * this, not of the shipping-inclusive figure.
 */
function vendorGroupMaterial(items: DisplayItem[]): number {
  return items.reduce((sum, i) => sum + i.materialPrice * i.quantity, 0);
}

/**
 * Per-vendor-group shipping total (cents), deduped by shippingId —
 * CraftCloud stores shipping per line item but bills it once per
 * order, so summing raw would double-count multi-item carts.
 */
function vendorGroupShipping(items: DisplayItem[]): number {
  return dedupeShippingByShipId(items);
}

/**
 * Right-aligned money value that collapses to a pulse skeleton while
 * its underlying line is re-quoting. Keeps the summary rows from
 * flashing a stale flat-multiplied total during a quantity change.
 */
function PriceCell({ cents, pending }: { cents: number; pending: boolean }) {
  if (pending) {
    return <span className="inline-block h-3.5 w-12 animate-pulse rounded bg-muted" />;
  }
  return <>${(cents / 100).toFixed(2)}</>;
}

interface CartPanelProps {
  /**
   * Which checkout architecture governs the fee-clamp math (see
   * lib/fees.ts). CartPanel is mounted globally from the app layout
   * rather than a per-order server page, so there's currently no
   * request-scoped `getCheckoutModel()` value threaded down to it —
   * defaults to "single" (no clamp), matching the pre-existing
   * behavior of this component. Pass the real value once a caller
   * threads it through.
   */
  checkoutModel?: CheckoutModel;
}

export function CartPanel({ checkoutModel = "single" }: CartPanelProps = {}) {
  const cart = useCart();
  if (!cart) return null;
  return <CartPanelInner checkoutModel={checkoutModel} />;
}

function CartPanelInner({ checkoutModel }: { checkoutModel: CheckoutModel }) {
  const cart = useCart()!;
  // The other checkout container (see price-display.tsx) — same reason.
  const sandbox = useSandbox();
  const {
    items,
    localItems,
    isOpen,
    close,
    removeItem,
    removeLocalItem,
    updateLocalItemQuantity,
    materializeLocalItems,
    materializing,
    loading,
  } = cart;
  const router = useRouter();

  const allItems = toDisplayItems(items, localItems);
  const isEmpty = allItems.length === 0;

  return (
    // Dialog.Root takes open + onOpenChange — wires to the cart context
    // open/close so focus is trapped and restored by base-ui.
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) close(); }}>
      <DialogContent
        aria-label="Cart"
        showCloseButton={false}
        className={cn(
          // Mobile: a bottom sheet anchored above the floating tab bar,
          // spanning the width so the cart reads at a comfortable size
          // rather than as a cramped floating card.
          "fixed inset-x-2 bottom-24 top-auto translate-x-0 translate-y-0 w-auto max-h-[70vh] overflow-y-auto rounded-3xl p-0",
          "data-open:animate-in data-open:fade-in data-open:slide-in-from-bottom-4 data-closed:animate-out data-closed:fade-out data-closed:slide-out-to-bottom-4 duration-200",
          // Desktop: the compact card pinned to the top-right.
          "md:inset-x-auto md:bottom-auto md:top-16 md:right-4 md:left-auto md:w-[380px] md:max-h-[calc(100vh-5rem)] md:rounded-xl md:data-open:slide-in-from-top-2 md:data-closed:slide-out-to-top-2",
          "sm:max-w-none"
        )}
      >
        {/* Grab-handle affordance — bottom-sheet only. */}
        <div className="mx-auto mt-2.5 h-1 w-10 shrink-0 rounded-full bg-muted-foreground/30 md:hidden" />
        <div className="flex items-center justify-between px-4 pt-3 pb-1 md:pt-3">
          <DialogTitle className="flex items-center gap-2 text-base leading-6 font-semibold">
            Cart
            {sandbox && <SandboxBadge />}
          </DialogTitle>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={close}
            aria-label="Close cart"
            className="-mr-1.5 text-muted-foreground"
          >
            <X size={16} />
          </Button>
        </div>

        {loading && isEmpty ? (
          <div
            role="status"
            className="flex items-center justify-center gap-2 px-4 pt-4 pb-6 text-sm text-muted-foreground"
          >
            <DottedSpinner />
            Loading your cart…
          </div>
        ) : isEmpty ? (
          // Same anatomy as <EmptyState bare> (components/ui/page.tsx),
          // inlined so the globally-mounted cart doesn't pull page
          // scaffolding (next/link et al.) into its bundle.
          <div className="flex flex-col items-center px-6 pt-4 pb-6 text-center">
            <p className="text-base leading-6 font-semibold">Your cart is empty</p>
            <p className="mt-1.5 max-w-xs text-sm text-pretty text-muted-foreground">
              Quote a print and add it here to check out several parts from
              one shop together.
            </p>
            <Button
              variant="secondary"
              size="sm"
              className="mt-4"
              onClick={() => {
                close();
                router.push("/print");
              }}
            >
              Start a print
            </Button>
          </div>
        ) : (
          <CartItemsList
            allItems={allItems}
            hasLocalItems={localItems.length > 0}
            removeItem={removeItem}
            removeLocalItem={removeLocalItem}
            updateLocalItemQuantity={updateLocalItemQuantity}
            materializeLocalItems={materializeLocalItems}
            materializing={materializing}
            close={close}
            checkoutModel={checkoutModel}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function CartItemsList({
  allItems,
  hasLocalItems,
  removeItem,
  removeLocalItem,
  updateLocalItemQuantity,
  materializeLocalItems,
  materializing,
  close,
  checkoutModel,
}: {
  allItems: DisplayItem[];
  hasLocalItems: boolean;
  removeItem: (id: string) => Promise<void>;
  removeLocalItem: (localId: string) => void;
  updateLocalItemQuantity: (localId: string, qty: number) => void;
  materializeLocalItems: () => Promise<{ ok: boolean; error?: string }>;
  materializing: boolean;
  close: () => void;
  checkoutModel: CheckoutModel;
}) {
  const router = useRouter();
  const { isSignedIn } = useUser();
  const { openAuth } = useAuthModal();

  const vendorGroups = useMemo(() => {
    const groups = new Map<
      string,
      { vendorId: string; vendorName: string | null; items: DisplayItem[] }
    >();
    for (const item of allItems) {
      const existing = groups.get(item.vendorId);
      if (existing) {
        existing.items.push(item);
        // First non-null vendor name wins — some older rows may not
        // have one cached yet.
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
  }, [allItems]);

  const handleRemove = (item: DisplayItem) => {
    if (item.isLocal) removeLocalItem(item.id);
    else removeItem(item.id);
  };

  // Only local items are handled here (pure client state, no server
  // round-trip). DB cart items go through VendorGroup's own handler
  // below, which owns the `error` banner state a rejected re-quote
  // needs to surface (MONEY-1).
  const handleUpdateLocalQty = (item: DisplayItem, qty: number) => {
    updateLocalItemQuantity(item.id, qty);
  };

  return (
    <div className="flex flex-col divide-y divide-border px-4 pb-4">
      {vendorGroups.map((group) => (
        <VendorGroup
          key={group.vendorId}
          group={group}
          onRemove={handleRemove}
          onUpdateLocalQty={handleUpdateLocalQty}
          isSignedIn={!!isSignedIn}
          openAuth={openAuth}
          hasLocalItems={hasLocalItems}
          materializeLocalItems={materializeLocalItems}
          materializing={materializing}
          close={close}
          router={router}
          checkoutModel={checkoutModel}
        />
      ))}
    </div>
  );
}

function VendorGroup({
  group,
  onRemove,
  onUpdateLocalQty,
  isSignedIn,
  openAuth,
  hasLocalItems,
  materializeLocalItems,
  materializing,
  close,
  router,
  checkoutModel,
}: {
  group: { vendorId: string; vendorName: string | null; items: DisplayItem[] };
  onRemove: (item: DisplayItem) => void;
  onUpdateLocalQty: (item: DisplayItem, qty: number) => void;
  isSignedIn: boolean;
  openAuth: (mode: "sign-in" | "sign-up") => void;
  hasLocalItems: boolean;
  materializeLocalItems: () => Promise<{ ok: boolean; error?: string }>;
  materializing: boolean;
  close: () => void;
  router: ReturnType<typeof useRouter>;
  checkoutModel: CheckoutModel;
}) {
  const cart = useCart();
  const [error, setError] = useState<string | null>(null);
  const [checkingOut, setCheckingOut] = useState(false);
  // Synchronous guard — React state doesn't flip until the next
  // render, so a rapid double-click could enter handleCheckout
  // twice and create two orders for the same vendor group. The
  // ref updates immediately.
  const checkingOutRef = useRef(false);

  // Any line still re-quoting after a quantity change makes the group
  // subtotal provisional (the changed line's price is in flux), so we
  // skeleton the money rows rather than flash a flat-multiplied total.
  const groupRepricing = group.items.some((i) => cart?.repricingIds.has(i.id));
  const material = vendorGroupMaterial(group.items);
  const shipping = vendorGroupShipping(group.items);
  // Service fee is 3% of material (production fee gets folded in
  // server-side at checkout — we don't have that figure here).
  // Single-sourced from lib/fees.ts so this figure can't drift from
  // what the server actually charges (including the two_step $0.50
  // minimum clamp).
  const serviceFee = calcServiceFee(material, checkoutModel);
  const total = material + serviceFee + shipping;

  const handleCheckout = async () => {
    setError(null);

    if (!isSignedIn) {
      openAuth("sign-up");
      return;
    }

    if (checkingOutRef.current) return;
    checkingOutRef.current = true;
    setCheckingOut(true);
    try {
      if (hasLocalItems) {
        const result = await materializeLocalItems();
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
      close();
      router.push(`/checkout/${result.orderId}`);
    } finally {
      setCheckingOut(false);
      checkingOutRef.current = false;
    }
  };

  // DB cart items re-quote server-side on a quantity change; a failed
  // re-quote is REJECTED (not silently committed with a stale quote —
  // MONEY-1), so surface it in the same error banner checkout errors
  // use. Local (anon, pre-materialize) items are plain client state
  // and never hit this path.
  const handleUpdateQty = async (item: DisplayItem, qty: number) => {
    if (item.isLocal) {
      onUpdateLocalQty(item, qty);
      return;
    }
    const result = await cart?.updateQuantity(item.id, qty);
    if (result && !result.ok) {
      setError(result.error);
    }
  };

  const lineCount = group.items.reduce((sum, i) => sum + i.quantity, 0);

  return (
    <section className="flex flex-col py-3 first:pt-1">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="truncate text-[13px] leading-[18px] font-medium text-muted-foreground">
          {group.vendorName ?? group.vendorId}
        </h3>
        <span className="shrink-0 text-xs text-subtle-foreground">
          {lineCount} {lineCount === 1 ? "item" : "items"}
        </span>
      </div>

      <div className="mt-1 flex flex-col">
        {group.items.map((item) => (
          <CartItemRow
            key={item.id}
            item={item}
            onRemove={() => onRemove(item)}
            onUpdateQty={(qty) => handleUpdateQty(item, qty)}
          />
        ))}
      </div>

      <dl className="mt-2 flex flex-col gap-1.5 border-t border-border pt-3 text-sm">
        <SummaryRow
          label="Material"
          value={<PriceCell cents={material} pending={groupRepricing} />}
        />
        <SummaryRow
          label="Service fee (3%)"
          value={<PriceCell cents={serviceFee} pending={groupRepricing} />}
        />
        <SummaryRow label="Shipping" value={`$${(shipping / 100).toFixed(2)}`} />
        <SummaryRow
          total
          label="Total"
          value={<PriceCell cents={total} pending={groupRepricing} />}
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

      {/* The cart is a popover / bottom sheet — a full-width action is
          the sheet exception in DESIGN_SYSTEM § Controls. */}
      <Button
        onClick={handleCheckout}
        loading={checkingOut || materializing}
        className="mt-3 w-full"
        size="lg"
      >
        {materializing
          ? "Preparing files…"
          : !isSignedIn
            ? "Sign up to check out"
            : "Check out"}
      </Button>
    </section>
  );
}

function CartItemRow({
  item,
  onRemove,
  onUpdateQty,
}: {
  item: DisplayItem;
  onRemove: () => void;
  onUpdateQty: (qty: number) => void;
}) {
  const cart = useCart();
  const repricing = !!cart?.repricingIds.has(item.id);
  const name = item.fileName ?? item.originalFilename;

  return (
    <CartLineRow
      name={name}
      quantity={item.quantity}
      unitCents={item.materialPrice}
      repricing={repricing}
      stale={item.staleQuote}
      onUpdateQty={onUpdateQty}
      onRemove={onRemove}
    />
  );
}
