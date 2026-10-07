"use client";

import { ShoppingCartIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
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
    <Button
      variant="secondary"
      size="sm"
      onClick={open}
      aria-label={`Cart (${itemCount} items)`}
      className="gap-1.5"
    >
      <ShoppingCartIcon aria-hidden="true" />
      Cart
      <span className="tabular-nums text-muted-foreground">
        {itemCount > 99 ? "99+" : itemCount}
      </span>
    </Button>
  );
}
