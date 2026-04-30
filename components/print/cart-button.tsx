"use client";

import { ShoppingCartIcon } from "lucide-react";
import { useCart } from "./cart-context";

/**
 * Cart icon in the top-right nav. Only shown when the cart actually
 * has something in it — an empty cart icon is just visual noise on
 * a personal-files-first product where most page visits don't
 * involve checkout.
 */
export function CartButton() {
  const cart = useCart();
  if (!cart) return null;
  const { itemCount, open } = cart;
  if (itemCount === 0) return null;

  return (
    <button
      onClick={open}
      className="relative rounded-md p-1.5 text-muted-foreground hover:text-foreground transition-colors"
      aria-label={`Cart (${itemCount} items)`}
    >
      <ShoppingCartIcon className="h-5 w-5" />
      <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-foreground px-1 text-[10px] font-semibold text-background">
        {itemCount > 99 ? "99+" : itemCount}
      </span>
    </button>
  );
}
