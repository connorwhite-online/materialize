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
      className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
      aria-label={`Cart (${itemCount} items)`}
    >
      <ShoppingCartIcon className="h-4 w-4 shrink-0" />
      <span>Cart</span>
      <span className="ml-0.5 rounded-full bg-primary px-1.5 py-1 text-xs font-semibold text-primary-foreground leading-none">
        {itemCount > 99 ? "99+" : itemCount}
      </span>
    </button>
  );
}
