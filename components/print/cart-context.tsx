"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import type { CartItemWithMeta } from "@/app/actions/cart";
import {
  getCart,
  addToCart,
  removeFromCart,
  repriceCartItem,
  getCartItemCount,
} from "@/app/actions/cart";
import { createDraftFileForPrint } from "@/app/actions/files";
import { uploadFileToR2 } from "@/components/upload/upload-file-to-r2";
import { pollQuotes, type QuoteSnapshot } from "./poll-quotes";

export interface LocalCartItem {
  localId: string;
  file: File;
  modelId: string;
  originalFilename: string;
  vendorId: string;
  vendorName?: string;
  materialConfigId: string;
  shippingId: string;
  // CraftCloud priceId the quoteId was resolved from — threaded so
  // addToCart can re-derive the authoritative price via getPrice()
  // instead of trusting materialPrice below (MTR-130).
  priceId: string;
  quoteId: string;
  quantity: number;
  materialPrice: number;
  shippingPrice: number;
  currency: string;
  countryCode: string;
}

interface CartContextValue {
  items: CartItemWithMeta[];
  localItems: LocalCartItem[];
  itemCount: number;
  isOpen: boolean;
  loading: boolean;
  materializing: boolean;
  /**
   * DB cart-item ids currently re-quoting after a quantity change.
   * The cart UIs render a price skeleton for these while the fresh
   * CraftCloud quote lands (the quantity number itself updates
   * optimistically — only the price is in flux).
   */
  repricingIds: ReadonlySet<string>;
  open: () => void;
  close: () => void;
  addItem: (params: {
    fileAssetId: string;
    priceId: string;
    quoteId: string;
    vendorId: string;
    vendorName?: string;
    materialConfigId: string;
    shippingId: string;
    quantity: number;
    materialPrice: number;
    shippingPrice: number;
    currency: string;
    countryCode: string;
  }) => Promise<{ cartItemId: string } | { error: string }>;
  addLocalItem: (
    params: Omit<LocalCartItem, "localId">
  ) => { ok: true } | { error: string };
  removeItem: (id: string) => Promise<void>;
  removeLocalItem: (localId: string) => void;
  updateQuantity: (
    id: string,
    quantity: number
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
  updateLocalItemQuantity: (localId: string, quantity: number) => void;
  materializeLocalItems: () => Promise<{ ok: boolean; error?: string }>;
  refresh: () => Promise<void>;
}

const CartContext = createContext<CartContextValue | null>(null);

export function useCart(): CartContextValue | null {
  return useContext(CartContext);
}

// Three-tier cart: (1) `localItems` — anon in-memory Files; (2) DB `cartItems`
// (Materialize cart); (3) CraftCloud cart — created only at checkout per vendor
// group (`createCart()` in lib/print/print.ts). Never equate the DB cart with a
// CraftCloud cart; they're separate concepts.
export function CartProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<CartItemWithMeta[]>([]);
  const [localItems, setLocalItems] = useState<LocalCartItem[]>([]);
  const [dbItemCount, setDbItemCount] = useState(0);
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [materializing, setMaterializing] = useState(false);
  const [repricingIds, setRepricingIds] = useState<ReadonlySet<string>>(
    () => new Set()
  );
  // Per-item AbortControllers so a rapid +/- spree cancels the stale
  // in-flight re-quote before starting the next one — otherwise an
  // earlier (slower) poll could land after a later one and write a
  // price for the wrong quantity.
  const repriceAbortRef = useRef<Map<string, AbortController>>(new Map());
  // Synchronous guard against concurrent materialize calls. The
  // `materializing` state flips on next render so two rapid clicks
  // (e.g. two vendor-group Checkout buttons) can both pass the
  // state-based disabled check and enter the function body —
  // duplicating uploads + cart inserts. A ref updates immediately.
  const materializingRef = useRef(false);

  const itemCount = dbItemCount + localItems.length;

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const result = await getCart();
      if ("items" in result) {
        setItems(result.items);
        setDbItemCount(result.items.length);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    getCartItemCount().then(setDbItemCount);
  }, []);

  const open = useCallback(async () => {
    setIsOpen(true);
    await refresh();
  }, [refresh]);

  const close = useCallback(() => setIsOpen(false), []);

  const addItem: CartContextValue["addItem"] = useCallback(
    async (params) => {
      const result = await addToCart(params);
      if ("cartItemId" in result) {
        setDbItemCount((c) => c + 1);
        // The /print cart-slot stack renders cart groups inline, so
        // the caller expects items to be queryable immediately after
        // a successful add — not only once the modal panel is
        // opened. Refresh here so both surfaces stay in sync.
        await refresh();
      }
      return result;
    },
    [refresh]
  );

  const addLocalItem = useCallback(
    (
      params: Omit<LocalCartItem, "localId">
    ): { ok: true } | { error: string } => {
      // Mirror the server-side currency guard (see addToCart). Both
      // paths feed into the same checkoutVendorGroup createCart call
      // which only accepts a single currency — mixing rails would
      // either mis-price items or 400 at the CraftCloud boundary.
      const existingCurrency =
        items[0]?.currency ?? localItems[0]?.currency ?? null;
      if (existingCurrency && existingCurrency !== params.currency) {
        return {
          error: `Your cart is in ${existingCurrency}. Clear it or finish that order before adding ${params.currency} items.`,
        };
      }
      setLocalItems((prev) => [
        ...prev,
        { ...params, localId: crypto.randomUUID() },
      ]);
      return { ok: true };
    },
    [items, localItems]
  );

  const removeItem = useCallback(async (id: string) => {
    await removeFromCart(id);
    setItems((prev) => prev.filter((i) => i.id !== id));
    setDbItemCount((c) => Math.max(0, c - 1));
  }, []);

  const removeLocalItem = useCallback((localId: string) => {
    setLocalItems((prev) => prev.filter((i) => i.localId !== localId));
  }, []);

  const setRepricing = useCallback((id: string, on: boolean) => {
    setRepricingIds((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const updateQuantity = useCallback(
    async (
      id: string,
      quantity: number
    ): Promise<{ ok: true } | { ok: false; error: string }> => {
      const item = items.find((i) => i.id === id);
      if (!item) {
        // Nothing to optimistically move and nothing to re-quote
        // against — this shouldn't happen from the rendered cart UI
        // (the id came from a rendered `items` row), but if it does,
        // reject rather than blind-write a bare quantity (MONEY-1: a
        // quantity write with no accompanying quote update is exactly
        // the desync this guards against).
        return {
          ok: false,
          error: "Couldn't find that cart item — refresh your cart and try again.",
        };
      }
      const previousQuantity = item.quantity;

      // Optimistically move the quantity number now; the price below
      // re-quotes in the background (CraftCloud per-unit prices drop
      // with volume, so we can't just flat-multiply the stored unit
      // price). The UI shows a price skeleton meanwhile. Reverted by
      // `reject` below if the re-quote doesn't land cleanly.
      setItems((prev) =>
        prev.map((i) => (i.id === id ? { ...i, quantity } : i))
      );

      // Cancel any earlier in-flight re-quote for this line.
      repriceAbortRef.current.get(id)?.abort();
      const controller = new AbortController();
      repriceAbortRef.current.set(id, controller);
      const { signal } = controller;

      // A re-quote failure (no matching quote, or a persist failure)
      // must NOT silently commit the new quantity against the OLD
      // quoteId — the quoteId bakes in the quantity it was originally
      // quoted at, and checkoutVendorGroup bills `quantity * price`
      // while CraftCloud produces whatever the quoteId itself encodes.
      // Reject the change and restore the last-known-good quantity
      // instead (MONEY-1) so the UI can show an inline retry prompt.
      const reject = (error: string): { ok: false; error: string } => {
        setItems((prev) =>
          prev.map((i) =>
            i.id === id ? { ...i, quantity: previousQuantity } : i
          )
        );
        return { ok: false, error };
      };

      setRepricing(id, true);
      try {
        const startRes = await fetch("/api/craftcloud/quotes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            fileAssetId: item.fileAssetId,
            currency: item.currency,
            countryCode: item.countryCode,
            quantity,
          }),
          signal,
        });
        if (!startRes.ok) throw new Error("requote start failed");
        const { priceId } = (await startRes.json()) as { priceId: string };

        const snapshots: QuoteSnapshot[] = [];
        await pollQuotes({
          priceId,
          signal,
          onSnapshot: (snapshot) => {
            snapshots.push(snapshot);
          },
        });
        if (signal.aborted) {
          // Superseded by a newer quantity change for this same line —
          // that call owns the optimistic value now; don't touch it.
          return { ok: false, error: "Superseded by a newer quantity change" };
        }

        const latest = snapshots[snapshots.length - 1];
        const match = latest?.quotes.find(
          (q) =>
            q.vendorId === item.vendorId &&
            q.materialConfigId === item.materialConfigId
        );

        if (!match) {
          return reject(
            "Couldn't get an updated price for this quantity. Please try again."
          );
        }

        const result = await repriceCartItem({
          cartItemId: id,
          quantity,
          quoteId: match.quoteId,
          materialPrice: match.price,
        });
        if ("error" in result) {
          return reject(result.error);
        }

        const newMaterialCents = Math.round(match.price * 100);
        setItems((prev) =>
          prev.map((i) =>
            i.id === id
              ? { ...i, quantity, quoteId: match.quoteId, materialPrice: newMaterialCents }
              : i
          )
        );
        return { ok: true };
      } catch (err) {
        if (signal.aborted || (err as { name?: string }).name === "AbortError") {
          return { ok: false, error: "Superseded by a newer quantity change" };
        }
        return reject("Couldn't re-price this item. Please try again.");
      } finally {
        // Only clear the repricing indicator if this call still owns
        // the abort ref for `id` — a superseded (aborted) call must
        // not turn off the skeleton for the live re-quote that
        // replaced it (MTR-133).
        if (repriceAbortRef.current.get(id) === controller) {
          repriceAbortRef.current.delete(id);
          setRepricing(id, false);
        }
      }
    },
    [items, setRepricing]
  );

  const updateLocalItemQuantity = useCallback(
    (localId: string, quantity: number) => {
      setLocalItems((prev) =>
        prev.map((i) => (i.localId === localId ? { ...i, quantity } : i))
      );
    },
    []
  );

  const materializeLocalItems = useCallback(async (): Promise<{
    ok: boolean;
    error?: string;
  }> => {
    if (localItems.length === 0) return { ok: true };
    // Synchronous reentry guard — see materializingRef comment.
    if (materializingRef.current) {
      return { ok: false, error: "Already preparing cart — please wait" };
    }
    materializingRef.current = true;
    setMaterializing(true);

    // Snapshot the queue at call time so state updates mid-loop
    // don't shift the iteration. Each successful item gets removed
    // from localItems immediately, so if a later item fails and the
    // user retries, we don't re-upload the ones that already
    // landed in the DB cart.
    const queue = [...localItems];

    try {
      for (const item of queue) {
        // Presign + PUT to R2 (shared helper — MONEY-3).
        const uploaded = await uploadFileToR2({
          file: item.file,
          filename: item.originalFilename,
          kind: "cart-materialize",
        });
        if ("error" in uploaded) return { ok: false, error: uploaded.error };
        const { storageKey, format } = uploaded;

        const draft = await createDraftFileForPrint({
          storageKey,
          originalFilename: item.originalFilename,
          format,
          fileSize: item.file.size,
        });
        if ("error" in draft) return { ok: false, error: draft.error };

        const cartResult = await addToCart({
          fileAssetId: draft.fileAssetId,
          priceId: item.priceId,
          quoteId: item.quoteId,
          vendorId: item.vendorId,
          vendorName: item.vendorName,
          materialConfigId: item.materialConfigId,
          shippingId: item.shippingId,
          quantity: item.quantity,
          materialPrice: item.materialPrice,
          shippingPrice: item.shippingPrice,
          currency: item.currency,
          countryCode: item.countryCode,
        });
        if ("error" in cartResult) return { ok: false, error: cartResult.error };

        // This item is now safely in the DB cart — drop it from
        // the local queue so a retry after a later failure
        // doesn't duplicate it.
        setLocalItems((prev) =>
          prev.filter((i) => i.localId !== item.localId)
        );
      }

      await refresh();
      return { ok: true };
    } finally {
      setMaterializing(false);
      materializingRef.current = false;
    }
  }, [localItems, refresh]);

  // Memoize the context value so consumers (cart button in the
  // nav, cart panel, quote configurator) don't re-render every
  // time CartProvider re-renders for an unrelated reason. The
  // callbacks are already useCallback'd above; this collapses the
  // whole value to a stable reference until one of these deps
  // actually changes.
  const value = useMemo<CartContextValue>(
    () => ({
      items,
      localItems,
      itemCount,
      isOpen,
      loading,
      materializing,
      repricingIds,
      open,
      close,
      addItem,
      addLocalItem,
      removeItem,
      removeLocalItem,
      updateQuantity,
      updateLocalItemQuantity,
      materializeLocalItems,
      refresh,
    }),
    [
      items,
      localItems,
      itemCount,
      isOpen,
      loading,
      materializing,
      repricingIds,
      open,
      close,
      addItem,
      addLocalItem,
      removeItem,
      removeLocalItem,
      updateQuantity,
      updateLocalItemQuantity,
      materializeLocalItems,
      refresh,
    ]
  );

  return (
    <CartContext.Provider value={value}>{children}</CartContext.Provider>
  );
}
