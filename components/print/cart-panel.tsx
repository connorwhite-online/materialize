"use client";

import { useEffect, useRef, useMemo, useState } from "react";
import { useUser } from "@clerk/nextjs";
import { useCart, type LocalCartItem } from "./cart-context";
import type { CartItemWithMeta } from "@/app/actions/cart";
import { useAuthModal } from "@/components/auth/auth-modal";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { XIcon, MinusIcon, PlusIcon, TrashIcon } from "lucide-react";
import { checkoutVendorGroup } from "@/app/actions/print";
import { dedupeShippingByShipId } from "@/lib/pricing/shipping";
import { useRouter } from "next/navigation";

const SERVICE_FEE_RATE = 0.03;

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
};

function toDisplayItems(
  dbItems: CartItemWithMeta[],
  localItems: LocalCartItem[]
): DisplayItem[] {
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
  }));
  return [...fromDb, ...fromLocal];
}

/**
 * Sum a vendor group's subtotal in cents, deduping shipping by
 * shippingId (see lib/pricing/shipping.ts).
 */
function vendorGroupSubtotal(items: DisplayItem[]): number {
  const material = items.reduce(
    (sum, i) => sum + i.materialPrice * i.quantity,
    0
  );
  const shipping = dedupeShippingByShipId(items);
  return material + shipping;
}

export function CartPanel() {
  const cart = useCart();
  if (!cart) return null;
  return <CartPanelInner />;
}

function CartPanelInner() {
  const cart = useCart()!;
  const {
    items,
    localItems,
    isOpen,
    close,
    removeItem,
    removeLocalItem,
    updateQuantity,
    updateLocalItemQuantity,
    materializeLocalItems,
    materializing,
    loading,
  } = cart;
  const panelRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (!isOpen) return;

    function handleClickOutside(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        close();
      }
    }

    function handleEscape(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [isOpen, close]);

  if (!isOpen) return null;

  const allItems = toDisplayItems(items, localItems);
  const isEmpty = allItems.length === 0;

  return (
    <div className="fixed inset-0 z-50">
      <div className="fixed inset-0 bg-black/20" />
      <div
        ref={panelRef}
        className="fixed right-4 top-16 w-[380px] max-h-[calc(100vh-5rem)] overflow-y-auto rounded-xl border border-border bg-background shadow-lg animate-in fade-in slide-in-from-top-2 duration-200 max-md:left-4 max-md:right-4 max-md:w-auto"
      >
        <div className="flex items-center justify-between p-4 pb-2">
          <h2 className="text-sm font-semibold">Cart</h2>
          <button
            onClick={close}
            className="rounded-md p-1 text-muted-foreground hover:text-foreground transition-colors"
          >
            <XIcon className="h-4 w-4" />
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
            updateQuantity={updateQuantity}
            updateLocalItemQuantity={updateLocalItemQuantity}
            materializeLocalItems={materializeLocalItems}
            materializing={materializing}
            close={close}
          />
        )}
      </div>
    </div>
  );
}

function CartItemsList({
  allItems,
  hasLocalItems,
  removeItem,
  removeLocalItem,
  updateQuantity,
  updateLocalItemQuantity,
  materializeLocalItems,
  materializing,
  close,
}: {
  allItems: DisplayItem[];
  hasLocalItems: boolean;
  removeItem: (id: string) => Promise<void>;
  removeLocalItem: (localId: string) => void;
  updateQuantity: (id: string, qty: number) => Promise<void>;
  updateLocalItemQuantity: (localId: string, qty: number) => void;
  materializeLocalItems: () => Promise<{ ok: boolean; error?: string }>;
  materializing: boolean;
  close: () => void;
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

  const handleUpdateQty = (item: DisplayItem, qty: number) => {
    if (item.isLocal) updateLocalItemQuantity(item.id, qty);
    else updateQuantity(item.id, qty);
  };

  return (
    <div className="px-4 pb-4">
      {vendorGroups.map((group, groupIdx) => (
        <VendorGroup
          key={group.vendorId}
          group={group}
          onRemove={handleRemove}
          onUpdateQty={handleUpdateQty}
          isSignedIn={!!isSignedIn}
          openAuth={openAuth}
          hasLocalItems={hasLocalItems}
          materializeLocalItems={materializeLocalItems}
          materializing={materializing}
          close={close}
          router={router}
          showSeparator={groupIdx < vendorGroups.length - 1}
        />
      ))}
    </div>
  );
}

function VendorGroup({
  group,
  onRemove,
  onUpdateQty,
  isSignedIn,
  openAuth,
  hasLocalItems,
  materializeLocalItems,
  materializing,
  close,
  router,
  showSeparator,
}: {
  group: { vendorId: string; vendorName: string | null; items: DisplayItem[] };
  onRemove: (item: DisplayItem) => void;
  onUpdateQty: (item: DisplayItem, qty: number) => void;
  isSignedIn: boolean;
  openAuth: (mode: "sign-in" | "sign-up") => void;
  hasLocalItems: boolean;
  materializeLocalItems: () => Promise<{ ok: boolean; error?: string }>;
  materializing: boolean;
  close: () => void;
  router: ReturnType<typeof useRouter>;
  showSeparator: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [checkingOut, setCheckingOut] = useState(false);

  const subtotal = vendorGroupSubtotal(group.items);
  const serviceFee = Math.round(subtotal * SERVICE_FEE_RATE);
  const total = subtotal + serviceFee;

  const handleCheckout = async () => {
    setError(null);

    if (!isSignedIn) {
      openAuth("sign-up");
      return;
    }

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
            onUpdateQty={(qty) => onUpdateQty(item, qty)}
          />
        ))}
      </div>

      <Separator className="my-3" />

      <div className="space-y-1 text-sm">
        <div className="flex justify-between text-muted-foreground">
          <span>Subtotal</span>
          <span>${(subtotal / 100).toFixed(2)}</span>
        </div>
        <div className="flex justify-between text-muted-foreground">
          <span>Service fee (3%)</span>
          <span>${(serviceFee / 100).toFixed(2)}</span>
        </div>
        <div className="flex justify-between font-semibold">
          <span>Total</span>
          <span>${(total / 100).toFixed(2)}</span>
        </div>
      </div>

      {error && (
        <p className="mt-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          {error}
        </p>
      )}

      <Button
        onClick={handleCheckout}
        disabled={checkingOut || materializing}
        className="w-full mt-3"
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
  const unitPrice = item.materialPrice / 100;
  const lineTotal = (item.materialPrice * item.quantity) / 100;

  return (
    <div className="flex items-start gap-3">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">
          {item.fileName ?? item.originalFilename}
        </p>
        <p className="text-xs text-muted-foreground">
          ${unitPrice.toFixed(2)} each
        </p>
      </div>

      <div className="flex items-center gap-1">
        <button
          onClick={() => item.quantity > 1 && onUpdateQty(item.quantity - 1)}
          disabled={item.quantity <= 1}
          className="rounded p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors"
        >
          <MinusIcon className="h-3.5 w-3.5" />
        </button>
        <span className="w-6 text-center text-sm tabular-nums">
          {item.quantity}
        </span>
        <button
          onClick={() => item.quantity < 100 && onUpdateQty(item.quantity + 1)}
          disabled={item.quantity >= 100}
          className="rounded p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors"
        >
          <PlusIcon className="h-3.5 w-3.5" />
        </button>
      </div>

      <span className="text-sm font-medium w-16 text-right tabular-nums">
        ${lineTotal.toFixed(2)}
      </span>

      <button
        onClick={onRemove}
        className="rounded p-0.5 text-muted-foreground hover:text-destructive transition-colors"
      >
        <TrashIcon className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
