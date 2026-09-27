"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { checkVendorMinimums } from "@/app/actions/print";
import type { Currency } from "@/lib/craftcloud/types";
import type {
  MinimumProbe,
  VendorMinimums,
} from "./material-picker/vendor-minimums";

const EMPTY: VendorMinimums = new Map();
/** Mirrors MAX_PROBES_PER_REQUEST in lib/craftcloud/vendor-minimums.ts. */
const PROBES_PER_CALL = 40;

/**
 * Vendor minimum order values for the print picker. `request` asks the
 * server about vendors not yet asked about in this currency; answers
 * merge into `minimums` and the picker re-ranks. A failed request
 * releases its vendors so a later request can retry them.
 */
export function useVendorMinimums(currency: Currency) {
  const [state, setState] = useState<{
    currency: Currency;
    minimums: VendorMinimums;
  }>({ currency, minimums: EMPTY });
  const requested = useRef(new Set<string>());
  const currencyRef = useRef(currency);

  // A region change prices in a new currency: forget everything.
  useEffect(() => {
    currencyRef.current = currency;
    requested.current = new Set();
  }, [currency]);

  const send = useCallback(
    (probes: MinimumProbe[], asked: Set<string>) => {
      checkVendorMinimums({ probes, currency }).then((result) => {
        // Answer for a currency we've since left — drop it.
        if (currencyRef.current !== currency) return;
        if ("error" in result) {
          for (const p of probes) asked.delete(p.vendorId);
          return;
        }
        // A vendor the server couldn't probe (stale quote id) stays
        // marked as asked: it keeps ranking as minimum-free rather than
        // re-firing a cart on every re-render.
        const answered = Object.entries(result.minimums);
        if (answered.length === 0) return;
        setState((prev) => {
          const next = new Map(
            prev.currency === currency ? prev.minimums : EMPTY
          );
          for (const [vendorId, minimum] of answered) {
            next.set(vendorId, minimum);
          }
          return { currency, minimums: next };
        });
      });
    },
    [currency]
  );

  const request = useCallback(
    (probes: MinimumProbe[]) => {
      const asked = requested.current;
      const fresh = probes.filter((p) => !asked.has(p.vendorId));
      if (fresh.length === 0) return;
      for (const p of fresh) asked.add(p.vendorId);
      for (let i = 0; i < fresh.length; i += PROBES_PER_CALL) {
        send(fresh.slice(i, i + PROBES_PER_CALL), asked);
      }
    },
    [send]
  );

  const minimums = state.currency === currency ? state.minimums : EMPTY;
  return { minimums, request };
}
