"use client";

import { ShoppingCartIcon } from "lucide-react";
import { useCart } from "./cart-context";

export function CartButton() {
  const cart = useCart();
  if (!cart) return null;
  const { itemCount, open } = cart;

  return (
    <button
      onClick={open}
      className="relative rounded-md p-1.5 text-muted-foreground hover:text-foreground transition-colors"
      aria-label={`Cart${itemCount > 0 ? ` (${itemCount} items)` : ""}`}
    >
      <ShoppingCartIcon className="h-5 w-5" />
      {itemCount > 0 && (
        <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-foreground px-1 text-[10px] font-semibold text-background">
          {itemCount > 99 ? "99+" : itemCount}
        </span>
      )}
    </button>
  );
}
