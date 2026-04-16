"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  type ReactNode,
} from "react";
import type { CartItemWithMeta } from "@/app/actions/cart";
import {
  getCart,
  addToCart,
  removeFromCart,
  updateCartItemQuantity,
  getCartItemCount,
} from "@/app/actions/cart";
import { createDraftFileForPrint } from "@/app/actions/files";

export interface LocalCartItem {
  localId: string;
  file: File;
  modelId: string;
  originalFilename: string;
  vendorId: string;
  materialConfigId: string;
  shippingId: string;
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
  open: () => void;
  close: () => void;
  addItem: (params: {
    fileAssetId: string;
    quoteId: string;
    vendorId: string;
    materialConfigId: string;
    shippingId: string;
    quantity: number;
    materialPrice: number;
    shippingPrice: number;
    currency: string;
    countryCode: string;
  }) => Promise<{ cartItemId: string } | { error: string }>;
  addLocalItem: (params: Omit<LocalCartItem, "localId">) => void;
  removeItem: (id: string) => Promise<void>;
  removeLocalItem: (localId: string) => void;
  updateQuantity: (id: string, quantity: number) => Promise<void>;
  updateLocalItemQuantity: (localId: string, quantity: number) => void;
  materializeLocalItems: () => Promise<{ ok: boolean; error?: string }>;
  refresh: () => Promise<void>;
}

const CartContext = createContext<CartContextValue | null>(null);

export function useCart(): CartContextValue | null {
  return useContext(CartContext);
}

export function CartProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<CartItemWithMeta[]>([]);
  const [localItems, setLocalItems] = useState<LocalCartItem[]>([]);
  const [dbItemCount, setDbItemCount] = useState(0);
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [materializing, setMaterializing] = useState(false);

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
      }
      return result;
    },
    []
  );

  const addLocalItem = useCallback(
    (params: Omit<LocalCartItem, "localId">) => {
      setLocalItems((prev) => [
        ...prev,
        { ...params, localId: crypto.randomUUID() },
      ]);
    },
    []
  );

  const removeItem = useCallback(async (id: string) => {
    await removeFromCart(id);
    setItems((prev) => prev.filter((i) => i.id !== id));
    setDbItemCount((c) => Math.max(0, c - 1));
  }, []);

  const removeLocalItem = useCallback((localId: string) => {
    setLocalItems((prev) => prev.filter((i) => i.localId !== localId));
  }, []);

  const updateQuantity = useCallback(
    async (id: string, quantity: number) => {
      await updateCartItemQuantity(id, quantity);
      setItems((prev) =>
        prev.map((i) => (i.id === id ? { ...i, quantity } : i))
      );
    },
    []
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
    setMaterializing(true);

    try {
      for (const item of localItems) {
        const presignRes = await fetch("/api/upload/presign", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            filename: item.originalFilename,
            contentType: "application/octet-stream",
            fileSize: item.file.size,
          }),
        });
        if (!presignRes.ok) {
          const data = await presignRes.json().catch(() => ({}));
          return {
            ok: false,
            error: data.error || "Upload presign failed",
          };
        }
        const { uploadUrl, storageKey, format } = (await presignRes.json()) as {
          uploadUrl: string;
          storageKey: string;
          format: "stl" | "obj" | "3mf" | "step" | "amf";
        };

        const putRes = await fetch(uploadUrl, {
          method: "PUT",
          headers: { "Content-Type": "application/octet-stream" },
          body: item.file,
        });
        if (!putRes.ok) {
          return { ok: false, error: "File upload failed" };
        }

        const draft = await createDraftFileForPrint({
          storageKey,
          originalFilename: item.originalFilename,
          format,
          fileSize: item.file.size,
        });
        if ("error" in draft) return { ok: false, error: draft.error };

        const cartResult = await addToCart({
          fileAssetId: draft.fileAssetId,
          quoteId: item.quoteId,
          vendorId: item.vendorId,
          materialConfigId: item.materialConfigId,
          shippingId: item.shippingId,
          quantity: item.quantity,
          materialPrice: item.materialPrice,
          shippingPrice: item.shippingPrice,
          currency: item.currency,
          countryCode: item.countryCode,
        });
        if ("error" in cartResult) return { ok: false, error: cartResult.error };
      }

      setLocalItems([]);
      await refresh();
      return { ok: true };
    } finally {
      setMaterializing(false);
    }
  }, [localItems, refresh]);

  return (
    <CartContext.Provider
      value={{
        items,
        localItems,
        itemCount,
        isOpen,
        loading,
        materializing,
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
      }}
    >
      {children}
    </CartContext.Provider>
  );
}
