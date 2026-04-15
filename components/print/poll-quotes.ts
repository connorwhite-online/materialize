import type { EnrichedQuote } from "./material-picker/types";

interface ShippingOption {
  shippingId: string;
  vendorId: string;
  name: string;
  deliveryTime: number;
  price: number;
  type: "standard" | "express";
}

export interface QuoteSnapshot {
  quotes: EnrichedQuote[];
  shipping: ShippingOption[];
  allComplete: boolean;
}

export interface PollQuotesOptions {
  priceId: string;
  signal: AbortSignal;
  /**
   * Called on every successful poll response (including the first
   * one). Safe to update React state directly from here — the
   * underlying loop is linear async, no overlap.
   */
  onSnapshot: (snapshot: QuoteSnapshot) => void;
}

const POLL_INTERVAL_MS = 1500;
const HARD_CEILING_MS = 90_000;
// Number of consecutive polls with no new quotes required before
// we trust CraftCloud's allComplete flag and break out. Raising
// this gives late vendors more time at the cost of a longer tail.
const STABLE_POLLS_REQUIRED = 4;

/**
 * Sleep helper that rejects with an AbortError when the signal
 * fires. Used between poll iterations so the loop exits cleanly
 * whenever the caller aborts.
 */
export function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const id = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(id);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Poll /api/craftcloud/quotes/poll until the quote set stabilises.
 *
 * **Termination invariant** — we do NOT trust CraftCloud's
 * `allComplete` flag alone. It can flip true while late-arriving
 * vendors are still trickling in, and it can come back true with an
 * empty array for cached library modelIds before any vendors have
 * responded. The loop only breaks when:
 *
 *   - `allComplete === true`, AND
 *   - `quotes.length` has not grown for `STABLE_POLLS_REQUIRED`
 *     consecutive snapshots (~6s of no growth).
 *
 * We also bail at `HARD_CEILING_MS` (90s) to cap the worst case, and
 * we swallow transient poll errors so a single 502 doesn't kill the
 * loop — the next iteration will retry.
 *
 * Each snapshot is handed to `onSnapshot` synchronously before we
 * sleep, so the caller can update UI state frame-by-frame.
 */
export async function pollQuotes({
  priceId,
  signal,
  onSnapshot,
}: PollQuotesOptions): Promise<void> {
  const isAbort = (err: unknown) =>
    signal.aborted || (err as { name?: string } | null)?.name === "AbortError";

  try {
    const started = Date.now();
    let lastQuoteCount = 0;
    let stablePolls = 0;

    while (!signal.aborted) {
      if (Date.now() - started > HARD_CEILING_MS) break;

      let pollRes: Response;
      try {
        pollRes = await fetch(
          `/api/craftcloud/quotes/poll?priceId=${encodeURIComponent(priceId)}`,
          { signal }
        );
      } catch (err) {
        if (isAbort(err)) return;
        // Transient network error — retry after the interval.
        await wait(POLL_INTERVAL_MS, signal);
        continue;
      }

      if (signal.aborted) return;
      if (!pollRes.ok) {
        await wait(POLL_INTERVAL_MS, signal);
        continue;
      }

      const snapshot = (await pollRes.json()) as QuoteSnapshot;
      onSnapshot(snapshot);

      const quoteCount = snapshot.quotes?.length ?? 0;
      if (quoteCount > lastQuoteCount) {
        stablePolls = 0;
        lastQuoteCount = quoteCount;
      } else {
        stablePolls++;
      }

      if (snapshot.allComplete && stablePolls >= STABLE_POLLS_REQUIRED) break;
      await wait(POLL_INTERVAL_MS, signal);
    }
  } catch (err) {
    // wait() rejects with AbortError when the signal fires
    // mid-sleep. Swallow that — it's the expected exit path.
    if (!isAbort(err)) throw err;
  }
}
