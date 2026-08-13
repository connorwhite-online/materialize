"use client";

import { useMemo, useRef, useState } from "react";
import { useUser } from "@clerk/nextjs";
import { useCart, type LocalCartItem } from "./cart-context";
import type { CartItemWithMeta } from "@/app/actions/cart";
import { useAuthModal } from "@/components/auth/auth-modal";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { MinusIcon, PlusIcon, TrashIcon } from "lucide-react";
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
  return <span>${(cents / 100).toFixed(2)}</span>;
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
        <div className="flex items-center justify-between p-4 pb-2 md:pt-4">
          <DialogTitle className="flex items-center gap-2 text-base font-semibold md:text-sm">
            Cart
            {sandbox && <SandboxBadge />}
          </DialogTitle>
          <button
            onClick={close}
            aria-label="Close cart"
            className="-mr-1 rounded-md p-1.5 text-muted-foreground hover:text-foreground transition-colors"
          >
            <svg
              aria-hidden="true"
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M18 6 6 18" /><path d="M6 6l12 12" />
            </svg>
          </button>
        </div>

        {loading && isEmpty ? (
          <div className="px-4 pb-6 pt-4">
            <p className="text-sm text-muted-foreground text-center">
              Loading...
            </p>
          </div>
        ) : isEmpty ? (
          <div className="px-4 pb-6 pt-4 text-center">
            <p className="text-sm text-muted-foreground">
              Your cart is empty.
            </p>
            <Button
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={() => {
                close();
                router.push("/print");
              }}
            >
              Start printing
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
    <div className="px-4 pb-4">
      {vendorGroups.map((group, groupIdx) => (
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
          showSeparator={groupIdx < vendorGroups.length - 1}
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
  showSeparator,
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
  showSeparator: boolean;
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

  return (
    <div>
      <p className="text-xs font-medium text-muted-foreground mb-2 mt-2">
        Vendor: {group.vendorName ?? group.vendorId}
      </p>

      <div className="space-y-3">
        {group.items.map((item) => (
          <CartItemRow
            key={item.id}
            item={item}
            onRemove={() => onRemove(item)}
            onUpdateQty={(qty) => handleUpdateQty(item, qty)}
          />
        ))}
      </div>

      <Separator className="my-3" />

      <div className="space-y-1 text-sm">
        <div className="flex justify-between text-muted-foreground">
          <span>Material</span>
          <PriceCell cents={material} pending={groupRepricing} />
        </div>
        <div className="flex justify-between text-muted-foreground">
          <span>Service fee (3%)</span>
          <PriceCell cents={serviceFee} pending={groupRepricing} />
        </div>
        <div className="flex justify-between text-muted-foreground">
          <span>Shipping</span>
          <span>${(shipping / 100).toFixed(2)}</span>
        </div>
        <div className="flex justify-between font-semibold">
          <span>Total</span>
          <PriceCell cents={total} pending={groupRepricing} />
        </div>
      </div>

      {error && (
        <p
          role="alert"
          className="mt-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive"
        >
          {error}
        </p>
      )}

      <Button
        onClick={handleCheckout}
        disabled={checkingOut || materializing}
        className="mt-3 h-11 w-full md:h-9"
        size="sm"
      >
        {materializing
          ? "Preparing files..."
          : checkingOut
            ? "Processing..."
            : !isSignedIn
              ? "Sign up to checkout"
              : "Checkout"}
      </Button>

      {showSeparator && <Separator className="my-4" />}
    </div>
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
  const unitPrice = item.materialPrice / 100;
  const lineTotal = (item.materialPrice * item.quantity) / 100;
  const name = item.fileName ?? item.originalFilename;

  return (
    <div className="flex items-start gap-3">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">
          {name}
        </p>
        {repricing ? (
          <span className="mt-1 inline-block h-3 w-16 animate-pulse rounded bg-muted align-middle" />
        ) : (
          <p className="text-xs text-muted-foreground">
            ${unitPrice.toFixed(2)} each
          </p>
        )}
        {item.staleQuote && (
          <p className="mt-0.5 text-[10px] text-amber-700 dark:text-amber-300">
            Quote may have expired — re-add from the print page if checkout fails.
          </p>
        )}
      </div>

      <div className="flex items-center gap-1">
        <button
          onClick={() => item.quantity > 1 && onUpdateQty(item.quantity - 1)}
          disabled={item.quantity <= 1}
          aria-label={`Decrease quantity of ${name}`}
          className="rounded p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors"
        >
          <MinusIcon className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
        <span className="w-6 text-center text-sm tabular-nums" aria-live="polite">
          {item.quantity}
        </span>
        <button
          onClick={() => item.quantity < 100 && onUpdateQty(item.quantity + 1)}
          disabled={item.quantity >= 100}
          aria-label={`Increase quantity of ${name}`}
          className="rounded p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors"
        >
          <PlusIcon className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>

      {repricing ? (
        <span className="w-16 flex justify-end">
          <span className="inline-block h-3.5 w-12 animate-pulse rounded bg-muted" />
        </span>
      ) : (
        <span className="text-sm font-medium w-16 text-right tabular-nums">
          ${lineTotal.toFixed(2)}
        </span>
      )}

      <button
        onClick={onRemove}
        aria-label={`Remove ${name} from cart`}
        className="rounded p-0.5 text-muted-foreground hover:text-destructive transition-colors"
      >
        <TrashIcon className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
    </div>
  );
}
