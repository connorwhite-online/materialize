"use client";

import { useState, useEffect, useCallback, useMemo, useRef, type ReactNode } from "react";
import type { PendingItem } from "./cart-slot-stack";
import { MaterialPicker } from "./material-picker";
import type {
  EnrichedQuote,
  OptimisticMaterial,
} from "./material-picker/types";
import { modelFitsInVolume } from "@/lib/craftcloud/fits-volume";
import type { MaterialsManifestResponse } from "@/app/api/craftcloud/materials-manifest/route";
import { PriceDisplay, type MinimumFeeInfo } from "./price-display";
import type { CheckoutModel } from "@/lib/env";
import type { Currency } from "@/lib/craftcloud/types";
import { ShippingAddressForm } from "./shipping-address-form";
import { pollQuotes } from "./poll-quotes";
import { runAnonCheckout } from "./run-anon-checkout";
import {
  FeePaymentSheet,
  SavedCardFeeSheet,
  type FeeSheetPayload,
  type SavedCardConfirmPayload,
} from "./fee-payment-sheet";
import { reportClientError } from "@/lib/observability/report-client-error";
import {
  createPrintOrder,
  completePrintOrder,
  checkCartPricing,
  checkoutVendorGroup,
} from "@/app/actions/print";
import { useCart } from "./cart-context";
import { useUser } from "@clerk/nextjs";
import { checkGeometry } from "@/lib/geometry-checks";
import { REGIONS, DEFAULT_REGION } from "@/lib/craftcloud/regions";
import { MaterialPreview } from "@/components/viewer/material-preview";
import { Label } from "@/components/ui/label";
import { Alert } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type Quote = EnrichedQuote;

/** Address payload the shipping form submits — also stashed for the
 * saved-card confirmation re-call. */
type CheckoutAddressData = {
  email: string;
  shipping: {
    firstName: string;
    lastName: string;
    address: string;
    addressLine2?: string;
    city: string;
    zipCode: string;
    stateCode?: string;
    countryCode: string;
    companyName?: string;
    phoneNumber?: string;
  };
  billing: {
    firstName: string;
    lastName: string;
    address: string;
    addressLine2?: string;
    city: string;
    zipCode: string;
    stateCode?: string;
    countryCode: string;
    companyName?: string;
    phoneNumber?: string;
    isCompany: boolean;
    vatId?: string;
  };
};

interface ShippingOption {
  shippingId: string;
  vendorId: string;
  name: string;
  deliveryTime: number;
  price: number;
  type: "standard" | "express";
}

export interface DraftModeConfig {
  /** CraftCloud model id — the client already uploaded the file. */
  modelId: string;
  /** Local File for the preview (object URL + future R2 upload). */
  file: File;
}

interface QuoteConfiguratorProps {
  /** Authed path — points at a row in our DB. */
  fileAssetId?: string;
  /**
   * Anon draft path — the file only exists client-side + on
   * CraftCloud. Mutually exclusive with fileAssetId.
   */
  draftMode?: DraftModeConfig;
  filename: string;
  format: string;
  hasCachedModel: boolean;
  geometryData: {
    dimensions?: { x: number; y: number; z: number };
    volume?: number;
    triangleCount?: number;
  } | null;
  /**
   * CraftCloud material id from /materials/[slug] → "Print with X".
   * Passed straight through to MaterialPicker, which exact-matches
   * it against the returned quotes to auto-advance past the
   * material step.
   */
  preselectMaterialId?: string;
  /**
   * CraftCloud finish group id. When provided alongside
   * preselectMaterialId, MaterialPicker jumps straight to vendor
   * selection, skipping both material and finish steps.
   */
  preselectFinishGroupId?: string;
  /**
   * Fired after a successful Add to Cart. The parent uses this to
   * pivot /print into the "what next?" state and expand the
   * matching vendor slot in the cart stack.
   */
  onAddedToCart?: (vendorId: string) => void;
  /**
   * Extra content rendered below PriceDisplay in the sticky right
   * column — used to slot the CartSlotStack beneath the active
   * session's order summary on /print. Receives the live
   * pendingItem so the stack can preview a merge into a matching
   * existing vendor cart.
   */
  rightAnnex?: (ctx: { pendingItem: PendingItem | null }) => ReactNode;
  /**
   * Optional page-level header (h1 + filename meta + creator
   * recommendation). On lg+ it renders next to the 3D viewer in a
   * 2-col sub-grid so the viewer can shrink to make room for the
   * controls instead of dominating the upper half. On mobile it
   * stays above the viewer in the natural top-to-bottom reading
   * order. Authed /print/[fileAssetId] passes its configureHeader
   * here; the anon /print page leaves it null since it has its own
   * inline FileContextBar pill at the top.
   */
  headerSlot?: ReactNode;
  /**
   * Checkout architecture for new orders — server-derived via
   * getCheckoutModel() in the page component and prop-drilled here
   * (lib/env reads process.env; only the TYPE is importable client
   * side). Forwarded to PriceDisplay so the "two charges" disclosure
   * renders next to the checkout button under two_step. Defaults to
   * "single" so existing call sites/tests are unaffected.
   */
  checkoutModel?: CheckoutModel;
}

type CheckoutStep = "configure" | "address" | "processing";
type LoadingPhase = "uploading" | "quoting" | "done" | "timeout";

// Sort anchor threshold — the picker re-ranks vendor/finish/material
// lists when total cost (production*qty + shipping) shifts. Re-running
// that on every quantity keystroke would feel jittery, so the picker
// holds a stable anchor and only bumps it when the user moves the
// quantity by more than this many units. 5 is small enough that a
// meaningful jump (1 → 10 units) re-ranks promptly, large enough that
// stepping the input from 1 → 4 doesn't shuffle the cards under the
// user's cursor.
const RERANK_QUANTITY_DELTA = 5;

export function QuoteConfigurator({
  fileAssetId,
  draftMode,
  filename,
  format,
  hasCachedModel,
  geometryData: initialGeometryData,
  preselectMaterialId,
  preselectFinishGroupId,
  onAddedToCart,
  rightAnnex,
  headerSlot,
  checkoutModel = "single",
}: QuoteConfiguratorProps) {
  const isDraft = !!draftMode;

  // Geometry can arrive two ways:
  //   (a) baked into the server render via the `geometryData` prop —
  //       happens for any fileAsset whose CraftCloud model + dims have
  //       already been cached on a previous visit;
  //   (b) returned by CraftCloud's upload response inside
  //       `ensureModelUploaded` — happens for a freshly uploaded asset
  //       whose first quote run is THIS one.
  // (a) is read-only, (b) writes to local state so the bounding-box
  // and dimensions-text panels render immediately without a refresh.
  const [geometryData, setGeometryData] = useState(initialGeometryData);
  // Keep state in sync when the parent re-mounts us with new server
  // data — e.g. router.refresh() after the cache-model POST resolves.
  useEffect(() => {
    if (initialGeometryData) setGeometryData(initialGeometryData);
  }, [initialGeometryData]);

  const [loadingPhase, setLoadingPhase] = useState<LoadingPhase | null>(
    // In draft mode the model is already on CraftCloud — skip straight
    // to quoting instead of sitting on the upload spinner.
    isDraft ? "quoting" : "uploading"
  );
  const [error, setError] = useState<string | null>(null);
  const [quotes, setQuotes] = useState<Quote[]>([]);
  // CraftCloud priceId the current `quotes` snapshot was polled from
  // — the server re-derives the authoritative per-unit price from
  // this via getPrice() instead of trusting the client-supplied
  // materialPrice on add-to-cart/checkout (MTR-130). Reset whenever
  // fetchQuotes starts a new price request (region/quantity/material
  // change) since the previous priceId's quotes are no longer valid.
  const [priceId, setPriceId] = useState<string | null>(null);
  // Optimistic material list — populated from the catalog manifest as
  // soon as it arrives (in parallel with quote polling), filtered by
  // the model's bounding box. Drives the skeleton-priced cards that
  // appear on the material step before real quotes land. Null until
  // we have both dimensions AND the manifest; an empty array means
  // "fetched but nothing fits this model".
  const [viableMaterials, setViableMaterials] = useState<
    OptimisticMaterial[] | null
  >(null);
  const [shipping, setShipping] = useState<ShippingOption[]>([]);
  const [selectedQuote, setSelectedQuote] = useState<Quote | null>(null);
  const [selectedShipping, setSelectedShipping] =
    useState<ShippingOption | null>(null);
  // Live mirrors of the current selection, used by the cart-pricing
  // effect to discard a stale (slow) checkCartPricing response whose
  // quote/vendor/shipping no longer matches what the user has picked.
  // See the effect below (CON-55).
  const selectedQuoteRef = useRef<Quote | null>(null);
  const selectedShippingRef = useRef<ShippingOption | null>(null);
  selectedQuoteRef.current = selectedQuote;
  selectedShippingRef.current = selectedShipping;
  const [quantity, setQuantity] = useState(1);
  // Quantity-at-last-rerank anchor for the picker's sort. Drifts
  // behind the live quantity until the user has moved by more than
  // RERANK_QUANTITY_DELTA, then snaps to the new quantity and the
  // picker re-ranks. See the constant's docstring for rationale.
  const [sortQuantity, setSortQuantity] = useState(1);
  useEffect(() => {
    if (Math.abs(quantity - sortQuantity) > RERANK_QUANTITY_DELTA) {
      setSortQuantity(quantity);
    }
  }, [quantity, sortQuantity]);
  // Drop a shipping option that belonged to a previously-selected vendor
  // when the user switches quotes. PriceDisplay only *hides* the stale
  // option (it filters by selectedQuote.vendorId), but the state stays
  // truthy and keeps checkout enabled — so without this, checkout could
  // fire with a shippingId/price from the wrong vendor. See CON-53.
  useEffect(() => {
    if (
      selectedShipping &&
      selectedQuote &&
      selectedShipping.vendorId !== selectedQuote.vendorId
    ) {
      setSelectedShipping(null);
    }
  }, [selectedQuote, selectedShipping]);

  // Region drives which country + currency we ask CraftCloud for
  // quotes in. Persisted to localStorage so the user's pick survives
  // page reloads. Default is the first region in REGIONS (US / USD).
  const [regionCode, setRegionCode] = useState<string>(DEFAULT_REGION.code);
  useEffect(() => {
    const stored =
      typeof window !== "undefined"
        ? window.localStorage.getItem("print-region")
        : null;
    if (stored && REGIONS.some((r) => r.code === stored)) {
      setRegionCode(stored);
    }
  }, []);
  const region =
    REGIONS.find((r) => r.code === regionCode) ?? DEFAULT_REGION;

  // Checkout state
  const [step, setStep] = useState<CheckoutStep>("configure");
  const [printOrderId, setPrintOrderId] = useState<string | null>(null);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  // Two-step embedded fee sheet payload — set when completePrintOrder
  // wants the fee confirmed in-page instead of via a Stripe redirect.
  const [feeSheet, setFeeSheet] = useState<FeeSheetPayload | null>(null);
  // Saved-card confirmation: completePrintOrder stops before any
  // charge when a saved method exists, and the re-call (with the
  // user's feePayment choice) needs the same address payload the
  // form submitted — stash both together.
  const [savedCardConfirm, setSavedCardConfirm] = useState<{
    payload: SavedCardConfirmPayload;
    address: CheckoutAddressData;
  } | null>(null);

  // Re-call checkout with the user's explicit fee-payment choice.
  // Returns { error } to keep the confirm sheet open with a message;
  // on success either navigates (saved card authorized) or swaps in
  // the Payment Element sheet (different card / one-tap declined).
  const resumeWithFeePayment = async (
    feePayment: "saved_card" | "new_card"
  ): Promise<{ error: string } | void> => {
    if (!savedCardConfirm) return { error: "Nothing to confirm." };
    const { payload, address } = savedCardConfirm;
    const result = await completePrintOrder({
      orderId: payload.orderId,
      email: address.email,
      shipping: address.shipping,
      billing: address.billing,
      isAnonFlow: checkoutStartedAnonRef.current,
      feePayment,
    });
    if ("error" in result) return { error: result.error };
    if ("feeSheet" in result) {
      setFeeSheet(result.feeSheet);
      setSavedCardConfirm(null);
      return;
    }
    if ("checkoutUrl" in result) {
      window.location.href = result.checkoutUrl;
      return;
    }
    // savedCardConfirm again — shouldn't happen once feePayment is
    // set; treat as retryable.
    return { error: "Something went wrong. Please try again." };
  };

  // The checkout error should only reflect the most recent attempt.
  // Any change to the quote, shipping, quantity, or region makes the
  // previous failure stale — clear it so the user doesn't see a red
  // banner for a configuration they've already moved past.
  useEffect(() => {
    setCheckoutError(null);
  }, [selectedQuote, selectedShipping, quantity, regionCode]);

  // Model URL for the preview viewer.
  // - Draft mode (anon, in-memory File): a blob URL we own.
  // - File-asset mode: a stable same-origin proxy URL — no JSON
  //   round-trip needed, the proxy enforces access on each request.
  const [previewModelUrl, setPreviewModelUrl] = useState<string | null>(() =>
    fileAssetId ? `/api/files/preview/${fileAssetId}` : null
  );

  useEffect(() => {
    if (!draftMode) {
      setPreviewModelUrl(
        fileAssetId ? `/api/files/preview/${fileAssetId}` : null
      );
      return;
    }
    const url = URL.createObjectURL(draftMode.file);
    setPreviewModelUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [fileAssetId, draftMode]);

  // The 3D preview tints the model with the selected quote's real
  // colorCode from CraftCloud's catalog. Falls back to a neutral
  // grey before anything is picked.
  const previewColor = useMemo(() => {
    if (!selectedQuote) return "#a1a1aa";
    return selectedQuote.colorCode || "#a1a1aa";
  }, [selectedQuote]);

  const previewableFormat =
    format === "stl" || format === "obj" || format === "3mf";

  // The modelId from the upload done in THIS session. Quote start
  // prefers it over the fileAssetId → DB lookup so a persistence
  // hiccup can't turn into a 409 "File not yet uploaded for printing"
  // loop from /api/craftcloud/quotes.
  const uploadedModelIdRef = useRef<string | null>(null);

  const ensureModelUploaded = useCallback(async () => {
    // Draft mode — the model was already uploaded client-side and we
    // have a modelId in hand. Nothing to do.
    if (draftMode) return;
    if (!fileAssetId) return;
    if (hasCachedModel) return;

    setLoadingPhase("uploading");

    // The upload runs SERVER-side (R2 → our route → CraftCloud).
    // CraftCloud's replacement upload endpoints only allow
    // https://craftcloud3d.com as an origin, so the browser cannot
    // call them — confirmed in prod as
    // craftcloud.model-upload-unreachable at the initiate leg. The
    // route also persists the modelId, replacing the separate
    // download-url + cache-model round trips this used to make.
    const res = await fetch("/api/craftcloud/upload-model", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileAssetId }),
    });

    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        step?: string;
      };
      const error = new Error(data.error || "Failed to upload model");
      reportClientError("craftcloud.model-upload-failed", error, {
        fileAssetId,
        status: res.status,
        step: data.step,
      });
      throw error;
    }

    const model = (await res.json()) as {
      modelId: string;
      dimensions: { x: number; y: number; z: number } | null;
      volume: number | null;
    };
    uploadedModelIdRef.current = model.modelId;

    // Surface the dimensions we just got back — the bounding box
    // overlay, the dimensions-text line, and the optimistic material
    // filter all key off this state and the user would otherwise see
    // them blank until a hard refresh.
    const dims = model.dimensions;
    const vol = model.volume;
    if (dims) {
      // Hoist into locals so the narrowing survives into the setState
      // updater closure — model.dimensions would widen back to
      // {x,y,z} | null inside the nested function.
      setGeometryData((prev) => ({
        ...(prev ?? {}),
        dimensions: dims,
        volume: vol ?? prev?.volume,
      }));
    }
  }, [fileAssetId, hasCachedModel, draftMode]);

  // Each fetchQuotes invocation owns an AbortController stored in
  // this ref. A new invocation aborts the previous one so a stale
  // region/quantity change can't clobber the user's current view
  // with half-finished polling from the old request.
  const pollAbortRef = useRef<AbortController | null>(null);

  // Guards handleAddressSubmit against double-fire. Without this,
  // a double-click (or rapid re-tap on mobile) would run the full
  // presign → R2 PUT → createDraftFileForPrint → createPrintOrder
  // → Stripe checkout chain twice in parallel, resulting in two
  // orders and two charges. Set at the top of the chain and
  // cleared on error so the user can retry.
  const checkoutInFlightRef = useRef(false);
  // Mirrors the checkoutInFlightRef pattern above, for "Proceed to
  // checkout" itself (handleCheckout). Without this, a double-tap
  // (mobile especially) creates two printOrders rows + two real
  // CraftCloud carts, and in the vendor-group branch two concurrent
  // cart.addItem calls hit the upsert's LEAST(100, quantity +
  // EXCLUDED.quantity) and silently double the quantity (MTR-232).
  // The ref is the synchronous reentry guard (state updates aren't
  // visible until the next render, same reason cart-context.tsx's
  // materializingRef exists); isCheckingOut is the state PriceDisplay
  // reads to disable the button and show "Processing...".
  const checkoutButtonInFlightRef = useRef(false);
  const [isCheckingOut, setIsCheckingOut] = useState(false);
  // Whether this checkout began while signed out. Captured at
  // handleCheckout time because, by the time the OTP sign-up completes
  // and handleAddressSubmit runs, `isAnon` has flipped to false — we
  // still want the just-signed-up user routed to the welcome dashboard.
  const checkoutStartedAnonRef = useRef(false);

  const cart = useCart();
  // Real auth state — NOT `draftMode`. An anon user printing a
  // *published* file lands here with a fileAssetId and no draftMode, so
  // gating the OTP-sign-up deferral on draftMode (as the old code did)
  // let them fall through to createPrintOrder → auth() null →
  // "Unauthorized". Anonymous == not signed in, regardless of how the
  // model got here. (Defaults to anon until Clerk loads, which is the
  // safe direction: the address step works for everyone; skipping it is
  // what breaks anon checkout.)
  const { isSignedIn } = useUser();
  const isAnon = !isSignedIn;
  const [isAddingToCart, setIsAddingToCart] = useState(false);

  // Shipping is chosen once per vendor cart. When the vendor being
  // configured already has cart items, reuse that cart's shipping
  // option — preselect and lock the picker rather than asking again.
  // The server enforces the same inheritance on add/checkout (see
  // addToCart), so this just keeps the UI honest about what will be
  // charged. Falls back to a normal (unlocked) picker if the existing
  // option isn't present in the current quote's shipping set.
  const existingVendorCartShippingId =
    selectedQuote && cart
      ? cart.items.find((i) => i.vendorId === selectedQuote.vendorId)
          ?.shippingId ?? null
      : null;
  const lockedShippingOption = existingVendorCartShippingId
    ? shipping.find((s) => s.shippingId === existingVendorCartShippingId) ?? null
    : null;
  useEffect(() => {
    if (
      lockedShippingOption &&
      selectedShipping?.shippingId !== lockedShippingOption.shippingId
    ) {
      setSelectedShipping(lockedShippingOption);
    }
  }, [lockedShippingOption, selectedShipping]);

  // Single polite live region message for the quote pipeline + the
  // quantity clamp (CON-62 / CON-64). Screen readers announce this on
  // change; we dedupe so the repeated poll snapshots don't re-announce
  // the same "Collecting quotes…" text on every 1.5s tick. The clamp
  // message is set imperatively from the quantity onChange handler and
  // is intentionally allowed to repeat (re-announce) even with the same
  // text by clearing first when a fresh clamp fires.
  const [statusMessage, setStatusMessage] = useState("");

  // Derive the phase message from the quote pipeline and announce it
  // only when the text actually changes. The poll loop drops a new
  // snapshot into `quotes` every ~1.5s; without this dedupe the live
  // region would re-fire "Collecting quotes…" on every tick.
  const quotePhaseMessage = useMemo(() => {
    if (loadingPhase === "uploading") return "Preparing your file…";
    if (loadingPhase === "quoting") {
      return quotes.length > 0
        ? `Collecting quotes — ${quotes.length} ${quotes.length === 1 ? "option" : "options"} so far`
        : "Collecting quotes…";
    }
    if (loadingPhase === "timeout") {
      return quotes.length > 0
        ? `Showing ${quotes.length} partial ${quotes.length === 1 ? "result" : "results"} — some vendors didn't respond in time`
        : "No quotes available — some vendors didn't respond in time";
    }
    // done
    if (quotes.length > 0) {
      const materialCount = new Set(quotes.map((q) => q.materialId)).size;
      return `Showing ${materialCount} ${materialCount === 1 ? "material" : "materials"}`;
    }
    return "No quotes available for this file";
  }, [loadingPhase, quotes]);

  useEffect(() => {
    setStatusMessage(quotePhaseMessage);
  }, [quotePhaseMessage]);

  // Vendor minimum production fee — probed via a lightweight cart
  // creation after the user picks a quote + shipping. The fee is
  // only available from CraftCloud's /v5/cart response, not in the
  // quote-level data, so we check as soon as both are selected.
  const [minimumFeeInfo, setMinimumFeeInfo] = useState<MinimumFeeInfo | null>(
    null
  );
  const [checkingMinimum, setCheckingMinimum] = useState(false);

  useEffect(() => {
    if (!selectedQuote || !selectedShipping) {
      setMinimumFeeInfo(null);
      setCheckingMinimum(false);
      return;
    }

    // Clear stale data from the previous vendor/quote while we check.
    setMinimumFeeInfo(null);
    setCheckingMinimum(true);

    let cancelled = false;
    // Tag this request with the quote/vendor it was issued for. On a
    // rapid vendor switch an older, slower checkCartPricing response
    // could otherwise land AFTER the newer one and overwrite
    // minimumFeeInfo with the WRONG vendor's fee (which then flows
    // into PriceDisplay's totals). We snapshot the identifiers here
    // and bail in the .then() if the live selection no longer matches.
    const issuedQuoteId = selectedQuote.quoteId;
    const issuedVendorId = selectedQuote.vendorId;
    const issuedShippingId = selectedShipping.shippingId;

    // Debounce — rapid shipping-option toggles would otherwise fire
    // a disposable CraftCloud cart-create per keystroke. 300ms is
    // short enough that a committed choice reflects quickly, long
    // enough that cycling through radio options while deliberating
    // only pays for the final pick.
    const handle = setTimeout(() => {
      checkCartPricing({
        quoteId: issuedQuoteId,
        vendorId: issuedVendorId,
        shippingId: issuedShippingId,
        currency: selectedQuote.currency as Currency,
      }).then((result) => {
        if (cancelled) return;
        // Ignore a response whose request was issued for a quote/
        // vendor/shipping the user has since moved away from. The
        // effect cleanup sets `cancelled` for the synchronous
        // re-run case, but a settimeout that already fired its
        // fetch before the switch needs this identity guard too —
        // its cleanup ran, but the in-flight promise still resolves.
        if (
          selectedQuoteRef.current?.quoteId !== issuedQuoteId ||
          selectedQuoteRef.current?.vendorId !== issuedVendorId ||
          selectedShippingRef.current?.shippingId !== issuedShippingId
        ) {
          return;
        }
        setCheckingMinimum(false);
        if ("error" in result) return;
        setMinimumFeeInfo(result);
      });
    }, 300);

    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [selectedQuote, selectedShipping, quantity]);

  const handleAddToCart = useCallback(async () => {
    if (!selectedQuote || !selectedShipping || !cart) return;
    if (!priceId) {
      setCheckoutError("Quotes are still loading. Please try again in a moment.");
      return;
    }
    setIsAddingToCart(true);
    setCheckoutError(null);
    try {
      if (draftMode) {
        const localResult = cart.addLocalItem({
          file: draftMode.file,
          modelId: draftMode.modelId,
          originalFilename: filename,
          priceId,
          quoteId: selectedQuote.quoteId,
          vendorId: selectedQuote.vendorId,
          vendorName: selectedQuote.vendorName,
          materialConfigId: selectedQuote.materialConfigId,
          shippingId: selectedShipping.shippingId,
          quantity,
          materialPrice: selectedQuote.price,
          shippingPrice: selectedShipping.price,
          currency: selectedQuote.currency,
          countryCode: region.code,
        });
        if ("error" in localResult) {
          setCheckoutError(localResult.error);
        } else {
          onAddedToCart?.(selectedQuote.vendorId);
        }
      } else if (fileAssetId) {
        const result = await cart.addItem({
          fileAssetId,
          priceId,
          quoteId: selectedQuote.quoteId,
          vendorId: selectedQuote.vendorId,
          vendorName: selectedQuote.vendorName,
          materialConfigId: selectedQuote.materialConfigId,
          shippingId: selectedShipping.shippingId,
          quantity,
          materialPrice: selectedQuote.price,
          shippingPrice: selectedShipping.price,
          currency: selectedQuote.currency,
          countryCode: region.code,
        });
        if ("error" in result) {
          setCheckoutError(result.error);
        } else {
          onAddedToCart?.(selectedQuote.vendorId);
        }
      }
    } finally {
      setIsAddingToCart(false);
    }
  }, [selectedQuote, selectedShipping, priceId, fileAssetId, draftMode, cart, quantity, region.code, filename, onAddedToCart]);

  // Active material scope for the CraftCloud price request. Starts
  // as the preselectMaterialId (from /materials/[slug] → Print with
  // X); a callback from MaterialPicker clears it when the user
  // navigates back to the full material grid, which then refetches
  // the unscoped quote set.
  const [scopedMaterialId, setScopedMaterialId] = useState<string | null>(
    preselectMaterialId ?? null
  );
  useEffect(() => {
    // If the parent passes a new preselect on a subsequent render
    // (rare — really only from a Link prefetch rehydration) adopt
    // it as the new scope.
    if (preselectMaterialId && preselectMaterialId !== scopedMaterialId) {
      setScopedMaterialId(preselectMaterialId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preselectMaterialId]);

  const fetchQuotes = useCallback(async () => {
    // Cancel any in-flight polling loop from a previous invocation.
    pollAbortRef.current?.abort();
    const controller = new AbortController();
    pollAbortRef.current = controller;
    const { signal } = controller;

    setLoadingPhase("quoting");
    setError(null);
    // Region/quantity switch: clear selection since the existing
    // quoteId is no longer valid against the new quote set.
    setSelectedQuote(null);
    setSelectedShipping(null);
    setPriceId(null);
    // Don't wipe the existing cards — they'll repopulate as new
    // poll snapshots come in, and keeping them avoids a flash of
    // empty state during a region change.

    try {
      // 1. Start the price request and get a priceId back.
      const startRes = await fetch("/api/craftcloud/quotes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(draftMode
            ? { modelId: draftMode.modelId }
            : uploadedModelIdRef.current
              ? { modelId: uploadedModelIdRef.current }
              : { fileAssetId }),
          currency: region.currency,
          countryCode: region.code,
          quantity,
          ...(scopedMaterialId ? { materialId: scopedMaterialId } : {}),
        }),
        signal,
      });
      if (!startRes.ok) {
        const data = await startRes.json().catch(() => ({}));
        const startError = new Error(data.error || "Failed to start quote request");
        reportClientError("quote.start-failed", startError, {
          fileAssetId,
          draftModelId: draftMode?.modelId,
        });
        throw startError;
      }
      const { priceId: newPriceId } = (await startRes.json()) as {
        priceId: string;
      };
      setPriceId(newPriceId);

      // 2. Hand off to the shared poll loop. See
      // components/print/poll-quotes.ts for the termination
      // invariant (allComplete + stable count). Each snapshot
      // drops straight into React state.
      let latestQuoteCount = 0;
      const reason = await pollQuotes({
        priceId: newPriceId,
        signal,
        onSnapshot: (snapshot) => {
          latestQuoteCount = snapshot.quotes?.length ?? 0;
          setQuotes(snapshot.quotes ?? []);
          setShipping(snapshot.shipping ?? []);
        },
      });

      if (!signal.aborted) {
        // "timeout" means we hit the hard ceiling before CraftCloud
        // marked the quote set stable — late vendors might still
        // arrive if the user retries. The picker uses this phase to
        // show a "showing partial results" hint with a Retry action
        // instead of the silent "Done" state.
        if (reason === "timeout") {
          reportClientError("quote.poll-timeout", new Error(reason), {
            priceId: newPriceId,
            quoteCount: latestQuoteCount,
          });
        }
        setLoadingPhase(reason === "timeout" ? "timeout" : "done");
      }
    } catch (err) {
      if (signal.aborted || (err as { name?: string }).name === "AbortError") {
        return;
      }
      throw err;
    }
  }, [
    fileAssetId,
    draftMode,
    quantity,
    region.currency,
    region.code,
    scopedMaterialId,
  ]);

  // Set once the model is confirmed on CraftCloud (or known to be
  // there already — draft mode / cached). Gates ensureModelUploaded so
  // a quantity/region/material tweak — which recreates fetchQuotes and
  // re-runs the init effect — does NOT re-run the CraftCloud upload
  // (download-url + cache-model). The upload only ever needs to happen
  // once per mount; quote refetches are cheap and expected to repeat.
  // See CON-56.
  const modelUploadedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    async function init() {
      try {
        // Only do the (expensive, idempotent-but-wasteful) CraftCloud
        // upload on the first run. ensureModelUploaded itself
        // early-returns in draft mode / when already cached, so guarding
        // here keeps that skip intact while preventing a redundant
        // re-upload on subsequent quantity/region changes.
        if (!modelUploadedRef.current) {
          await ensureModelUploaded();
          if (cancelled) return;
          modelUploadedRef.current = true;
        }
        await fetchQuotes();
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Something went wrong");
          setLoadingPhase("done");
        }
      }
    }

    init();
    return () => {
      cancelled = true;
      pollAbortRef.current?.abort();
    };
  }, [ensureModelUploaded, fetchQuotes]);

  // Fetch the materials manifest in parallel with quote polling and
  // filter to the materials whose build volume can actually fit this
  // model. Independent of the quote pipeline — even if quoting fails,
  // these cards still render so the user has something to look at.
  // Skipped when we don't know the dimensions (we'd be guessing) or
  // when the request is scoped to a single material via preselect
  // (the picker auto-advances past the material step in that case).
  const dims = geometryData?.dimensions;
  const dimsReady =
    !!dims &&
    typeof dims.x === "number" &&
    typeof dims.y === "number" &&
    typeof dims.z === "number";
  useEffect(() => {
    if (!dimsReady || !dims) {
      setViableMaterials(null);
      return;
    }
    if (scopedMaterialId) {
      setViableMaterials(null);
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    (async () => {
      try {
        const res = await fetch("/api/craftcloud/materials-manifest", {
          signal: controller.signal,
        });
        if (!res.ok) return;
        const data = (await res.json()) as MaterialsManifestResponse;
        if (cancelled) return;
        const modelDims: [number, number, number] = [dims.x, dims.y, dims.z];
        const viable = data.materials
          // Keep materials that publish a max volume the model fits in.
          // Materials without a published max are ambiguous — skip them
          // here; they'll still appear if a real quote comes back.
          .filter(
            (m) =>
              m.maxDimensions !== null &&
              modelFitsInVolume(modelDims, m.maxDimensions)
          )
          .map<OptimisticMaterial>((m) => ({
            id: m.id,
            name: m.name,
            groupId: m.groupId,
            groupName: m.groupName,
            image: m.image,
            sortIndex: m.sortIndex,
          }));
        setViableMaterials(viable);
      } catch {
        // Manifest is best-effort; if it fails the picker silently
        // falls back to the no-optimistic-cards behavior. The real
        // quote polling is the source of truth either way.
      }
    })();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [dimsReady, dims, scopedMaterialId]);


  const handleCheckout = async () => {
    if (!selectedQuote || !selectedShipping) return;
    // Synchronous reentry guard — a double-tap (mobile especially)
    // fires two overlapping invocations before the isCheckingOut
    // state update from the first is even visible to React, so the
    // state alone can't prevent it (same reason cart-context.tsx's
    // materializingRef exists). See the ref's declaration for the
    // full rationale (MTR-232).
    if (checkoutButtonInFlightRef.current) return;
    checkoutButtonInFlightRef.current = true;
    setIsCheckingOut(true);
    setCheckoutError(null);
    checkoutStartedAnonRef.current = isAnon;

    try {
      // Defer order creation to after the address step whenever we can't
      // create an order here:
      //   - draftMode: the model is an in-memory file with no DB row yet;
      //     runAnonCheckout uploads it after sign-up.
      //   - isAnon: createPrintOrder requires auth — the OTP sign-up runs
      //     inside the address form first (this is the published-file anon
      //     case that previously 401'd as "Unauthorized").
      //   - !fileAssetId: nothing to order against (defensive).
      // The heavy chain runs in handleAddressSubmit once the session is
      // live.
      if (draftMode || !fileAssetId || isAnon) {
        setStep("address");
        return;
      }

      if (!priceId) {
        setCheckoutError("Quotes are still loading. Please try again in a moment.");
        return;
      }

      // If this vendor already has items in the cart, "Proceed to
      // checkout" should pay for the whole vendor group, not just the
      // item being configured — otherwise the user silently leaves the
      // rest of that manufacturer's cart behind. Fold the current item
      // in (addItem inherits the group's shipping, see addToCart) and
      // check out the group. With no existing items we keep the leaner
      // single-item createPrintOrder path.
      const hasExistingVendorItems =
        !!cart && cart.items.some((i) => i.vendorId === selectedQuote.vendorId);

      if (hasExistingVendorItems && cart) {
        const added = await cart.addItem({
          fileAssetId,
          priceId,
          quoteId: selectedQuote.quoteId,
          vendorId: selectedQuote.vendorId,
          vendorName: selectedQuote.vendorName,
          materialConfigId: selectedQuote.materialConfigId,
          shippingId: selectedShipping.shippingId,
          quantity,
          materialPrice: selectedQuote.price,
          shippingPrice: selectedShipping.price,
          currency: selectedQuote.currency,
          countryCode: region.code,
        });
        if ("error" in added) {
          setCheckoutError(added.error);
          return;
        }

        const grouped = await checkoutVendorGroup(selectedQuote.vendorId);
        if ("error" in grouped) {
          setCheckoutError(grouped.error);
          return;
        }
        await cart.refresh();
        setPrintOrderId(grouped.orderId);
        setStep("address");
        return;
      }

      const result = await createPrintOrder({
        fileAssetId,
        priceId,
        quoteId: selectedQuote.quoteId,
        vendorId: selectedQuote.vendorId,
        vendorName: selectedQuote.vendorName,
        materialConfigId: selectedQuote.materialConfigId,
        shippingId: selectedShipping.shippingId,
        quantity,
        materialPrice: selectedQuote.price,
        shippingPrice: selectedShipping.price,
        currency: selectedQuote.currency as "USD",
      });

      if ("error" in result) {
        setCheckoutError(result.error);
        return;
      }

      setPrintOrderId(result.orderId);
      setStep("address");
    } finally {
      // Covers every exit path above — the early-return branches
      // (draft/anon handoff, vendor-group checkout, single-order
      // checkout, every error) as well as the two success paths.
      // Success here moves to the address step within this same
      // component (unlike handleAddressSubmit's Stripe redirect,
      // nothing unmounts us), so the button must be re-enabled either
      // way or a user who backs up to "configure" would find it
      // stuck disabled.
      checkoutButtonInFlightRef.current = false;
      setIsCheckingOut(false);
    }
  };

  const handleAddressSubmit = async (addressData: CheckoutAddressData) => {
    // Bail immediately if a previous handleAddressSubmit is still
    // in flight (double-click, mobile tap repeat). Without this
    // guard, the anon chain below would fire the entire R2 →
    // draft → order → Stripe pipeline twice in parallel.
    if (checkoutInFlightRef.current) return;
    checkoutInFlightRef.current = true;

    setStep("processing");
    setCheckoutError(null);

    // Draft path — ShippingAddressForm just finished the Clerk OTP
    // sign-up so the session is hot. Run the shared checkout
    // chain and redirect to Stripe on success.
    if (draftMode) {
      if (!selectedQuote || !selectedShipping || !priceId) {
        setCheckoutError("Please pick a material and a shipping option.");
        setStep("address");
        checkoutInFlightRef.current = false;
        return;
      }

      const result = await runAnonCheckout({
        file: draftMode.file,
        selectedQuote: {
          priceId,
          quoteId: selectedQuote.quoteId,
          vendorId: selectedQuote.vendorId,
          vendorName: selectedQuote.vendorName,
          materialConfigId: selectedQuote.materialConfigId,
          price: selectedQuote.price,
          currency: selectedQuote.currency,
        },
        selectedShipping: {
          shippingId: selectedShipping.shippingId,
          price: selectedShipping.price,
        },
        quantity,
        addressData,
      });

      if (!result.ok) {
        setCheckoutError(result.error);
        setStep("address");
        checkoutInFlightRef.current = false;
        return;
      }

      if ("feeSheet" in result) {
        // In-page fee sheet: the flow pauses for user input, so the
        // double-fire guard must release — closing the sheet returns
        // to the address step for another attempt.
        setFeeSheet(result.feeSheet);
        checkoutInFlightRef.current = false;
        return;
      }

      if ("savedCardConfirm" in result) {
        // Existing account with a saved card (sign-in pivot):
        // confirm before charging. Same pause-for-input release as
        // the fee sheet.
        setSavedCardConfirm({
          payload: result.savedCardConfirm,
          address: addressData,
        });
        checkoutInFlightRef.current = false;
        return;
      }

      window.location.href = result.checkoutUrl;
      return;
    }

    // fileAssetId path. Authed users pre-created the order in
    // handleCheckout (printOrderId is set). Anon users who just
    // completed the inline OTP sign-up have no order yet — their
    // session is live now (the form finished setActive before calling
    // onSubmit), so create it here before building the Stripe session.
    let orderId = printOrderId;
    if (!orderId) {
      if (!fileAssetId || !selectedQuote || !selectedShipping || !priceId) {
        setCheckoutError("Please pick a material and a shipping option.");
        setStep("address");
        checkoutInFlightRef.current = false;
        return;
      }
      const created = await createPrintOrder({
        fileAssetId,
        priceId,
        quoteId: selectedQuote.quoteId,
        vendorId: selectedQuote.vendorId,
        vendorName: selectedQuote.vendorName,
        materialConfigId: selectedQuote.materialConfigId,
        shippingId: selectedShipping.shippingId,
        quantity,
        materialPrice: selectedQuote.price,
        shippingPrice: selectedShipping.price,
        currency: selectedQuote.currency as "USD",
      });
      if ("error" in created) {
        setCheckoutError(created.error);
        setStep("address");
        checkoutInFlightRef.current = false;
        return;
      }
      orderId = created.orderId;
    }

    const result = await completePrintOrder({
      orderId,
      email: addressData.email,
      shipping: addressData.shipping,
      billing: addressData.billing,
      // Just-signed-up users land on the welcome dashboard, mirroring
      // the draft anon flow. checkoutStartedAnonRef survives the
      // post-sign-up re-render that flips isAnon false.
      isAnonFlow: checkoutStartedAnonRef.current,
    });

    if ("error" in result) {
      setCheckoutError(result.error);
      setStep("address");
      checkoutInFlightRef.current = false;
      return;
    }

    if ("feeSheet" in result) {
      setFeeSheet(result.feeSheet);
      checkoutInFlightRef.current = false;
      return;
    }

    if ("savedCardConfirm" in result) {
      setSavedCardConfirm({
        payload: result.savedCardConfirm,
        address: addressData,
      });
      checkoutInFlightRef.current = false;
      return;
    }

    window.location.href = result.checkoutUrl;
  };

  // Only the initial upload-to-CraftCloud step still gates the UI —
  // we need a craftCloudModelId before we can ask for a quote at all.
  // Once that's done, the picker renders immediately with catalog
  // data and the quote polling happens in the background.
  if (loadingPhase === "uploading") {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-center">
          <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-muted border-t-foreground" />
          <p className="mt-3 text-sm text-muted-foreground">
            Preparing your file for manufacturing...
          </p>
          <p className="mt-1 text-xs text-muted-foreground/60">
            This may take a moment for large files
          </p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <Alert variant="destructive" className="flex flex-col items-start gap-3">
        <div>
          <p className="text-sm font-medium">We couldn&apos;t load quotes for this file</p>
          <p className="mt-1 text-xs opacity-90">{error}</p>
        </div>
        <button
          type="button"
          onClick={() => {
            setError(null);
            // A failed CraftCloud upload leaves no modelId anywhere —
            // retrying fetchQuotes alone would 409 ("File not yet
            // uploaded for printing") on every click, forever. Re-run
            // the upload first when it never completed.
            const needsUpload = !isDraft && !modelUploadedRef.current;
            setLoadingPhase(needsUpload ? "uploading" : "quoting");
            (async () => {
              if (needsUpload) {
                await ensureModelUploaded();
                modelUploadedRef.current = true;
              }
              await fetchQuotes();
            })().catch((err) => {
              setError(err instanceof Error ? err.message : "Something went wrong");
              setLoadingPhase("done");
            });
          }}
          className="rounded-md border border-current/30 bg-background/60 px-3 py-1 text-xs font-medium hover:bg-background/90"
        >
          Retry
        </button>
      </Alert>
    );
  }

  // Shape the current selection as a PendingItem so the cart-slot
  // stack on the right can preview a merge into a matching vendor
  // cart. Only populated once a quote is picked — before that,
  // there's no vendor to merge into.
  const pendingItem: PendingItem | null = selectedQuote
    ? {
        vendorId: selectedQuote.vendorId,
        filename,
        quantity,
        materialPrice: Math.round(selectedQuote.price * 100),
      }
    : null;

  if (step === "address" || step === "processing") {
    return (
      <div className="max-w-lg mx-auto">
        {checkoutError && (
          <Alert variant="destructive" className="mb-4">
            <p className="text-sm">{checkoutError}</p>
          </Alert>
        )}
        {/* Authed path: announce processing state to SR (anon path
            already has its own role="status" inside ShippingAddressForm). */}
        {step === "processing" && !isAnon && (
          <p role="status" className="sr-only">
            Placing your order…
          </p>
        )}
        <ShippingAddressForm
          onSubmit={handleAddressSubmit}
          onBack={() => setStep("configure")}
          isSubmitting={step === "processing"}
          anonMode={isAnon}
        />
        <FeePaymentSheet
          sheet={feeSheet}
          onClose={() => {
            // Dismissed without paying — back to the address step so
            // resubmitting reopens the sheet (same PI via idempotency).
            setFeeSheet(null);
            setStep("address");
          }}
        />
        <SavedCardFeeSheet
          confirm={savedCardConfirm?.payload ?? null}
          onAuthorize={() => resumeWithFeePayment("saved_card")}
          onUseDifferentCard={() => resumeWithFeePayment("new_card")}
          onClose={() => {
            setSavedCardConfirm(null);
            setStep("address");
          }}
        />
      </div>
    );
  }

  const dimensionsText =
    geometryData?.dimensions &&
    typeof geometryData.dimensions.x === "number" &&
    typeof geometryData.dimensions.y === "number" &&
    typeof geometryData.dimensions.z === "number" ? (
      <div className="text-sm text-muted-foreground">
        Dimensions: {geometryData.dimensions.x.toFixed(1)} ×{" "}
        {geometryData.dimensions.y.toFixed(1)} ×{" "}
        {geometryData.dimensions.z.toFixed(1)} mm
      </div>
    ) : null;

  return (
    <div>
      {/*
        Single polite live region for the quote pipeline + quantity
        clamp. Announces phase changes ("Collecting quotes…", "Showing
        N materials", "No quotes available") and clamp feedback to
        screen readers without stealing focus. Visually hidden — the
        sighted equivalents live in MaterialStep's copy + loader.
        Deduped above so the repeating poll snapshots don't re-announce
        the same text. See CON-62 / CON-64.
      */}
      <div role="status" aria-live="polite" className="sr-only">
        {statusMessage}
      </div>
      <div className="grid items-start gap-8 lg:grid-cols-3">
        <div className="lg:col-span-2">
          {/*
            Mobile-only render of the page header above the sub-grid
            so reading order on a phone stays top-down: header →
            viewer → controls → picker. On desktop we hide this copy
            and render a second copy inside the right side-panel
            below, alongside the controls.
          */}
          {headerSlot && <div className="mb-6 lg:hidden">{headerSlot}</div>}

          {/*
            Upper sub-grid splits into viewer (left) + side-panel
            (right) on lg+. The viewer used to take the full width
            of the col-span-2 area and dominate the upper half;
            shrinking it to ~60% lets the file metadata, dimensions,
            and quantity/region controls sit beside it instead of
            stacking below.

            On mobile this collapses to a single column — viewer
            then side-panel — which preserves the previous reading
            order (after the mobile-only header above).
          */}
          <div className="grid gap-6 lg:grid-cols-[3fr_2fr] lg:items-start">
            {previewModelUrl && previewableFormat && (
              <div className="aspect-[4/3] w-full overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-muted/40 to-muted/10">
                <MaterialPreview
                  modelUrl={previewModelUrl}
                  format={format as "stl" | "obj" | "3mf"}
                  materialColor={previewColor}
                  className="h-full w-full"
                  enableWheelZoom={false}
                  showZoomControls
                />
              </div>
            )}

            <div className="space-y-4">
              {/* Desktop-only header — twin of the lg:hidden copy
                  above, rendered here so it sits beside the viewer
                  on wide layouts. Static markup, safe to duplicate. */}
              {headerSlot && (
                <div className="hidden lg:block">{headerSlot}</div>
              )}

              {dimensionsText}

              {/*
                Stack the controls on mobile, side-by-side from sm+.
                At 390px the row's natural width (~395px content)
                exceeds the available 358px, and flex-wrap behavior
                with the select's min-w-44 produced an x-scroll on
                iOS Safari instead of cleanly wrapping. flex-col
                below sm sidesteps it entirely and reads better at
                phone widths anyway.
              */}
              <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-4">
                <div className="flex items-center gap-2">
                  <Label
                    htmlFor="quantity"
                    className="mb-0 text-sm font-medium leading-none"
                  >
                    Quantity
                  </Label>
                  {/*
                    Plain input rather than <Input> so it can wear the
                    same flat frosted pill as the Ship-to <Select>
                    sitting next to it (translucent card fill + blur +
                    crisp focus ring). Same height, padding, radius, and
                    focus treatment as SelectTrigger so the two line up
                    as a matched pair.
                  */}
                  <input
                    id="quantity"
                    type="number"
                    min={1}
                    max={100}
                    value={quantity}
                    aria-describedby="quantity-range-hint"
                    onChange={(e) => {
                      // Clamp to [1, 100] and reject NaN — empty/
                      // invalid text falls back to 1 so the quote
                      // pipeline never sees a non-finite number.
                      const raw = Number(e.target.value);
                      const clamped = Number.isFinite(raw)
                        ? Math.min(100, Math.max(1, Math.trunc(raw)))
                        : 1;
                      // Announce a silent clamp through the shared
                      // status region (CON-64). Only when the typed
                      // value was finite AND fell outside [1,100] — a
                      // plain in-range edit shouldn't speak. Clear
                      // first so an identical repeat clamp re-fires.
                      if (Number.isFinite(raw) && Math.trunc(raw) !== clamped) {
                        setStatusMessage("");
                        setStatusMessage(
                          `Quantity must be between 1 and 100. Adjusted to ${clamped}.`
                        );
                      }
                      setQuantity(clamped);
                    }}
                    // text-base on phones (iOS auto-zooms < 16px),
                    // text-sm on md+ to match the rest of the row.
                    className="h-10 w-20 rounded-xl border border-border bg-card/60 backdrop-blur-sm px-3.5 py-1 text-base md:text-sm outline-none transition-[color,box-shadow,border-color] duration-150 ease-out hover:bg-card focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40 dark:border-input dark:bg-input/30"
                  />
                  <span id="quantity-range-hint" className="sr-only">
                    Enter a quantity between 1 and 100.
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Label
                    htmlFor="region"
                    className="mb-0 text-sm font-medium leading-none"
                  >
                    Ship to
                  </Label>
                  <Select
                    value={regionCode}
                    onValueChange={(value) => {
                      if (!value) return;
                      setRegionCode(value);
                      if (typeof window !== "undefined") {
                        window.localStorage.setItem("print-region", value);
                      }
                    }}
                  >
                    <SelectTrigger id="region" className="min-w-44">
                      <SelectValue>
                        {(value) => {
                          const r = REGIONS.find((r) => r.code === value);
                          if (!r) return DEFAULT_REGION.name;
                          return `${r.name} (${r.currency})`;
                        }}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {REGIONS.map((r) => (
                        <SelectItem key={r.code} value={r.code}>
                          {r.name} ({r.currency})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Geometry hints — soft warnings, never blocking */}
              {(() => {
                const hints = checkGeometry(geometryData);
                if (hints.length === 0) return null;
                return (
                  <div className="space-y-2">
                    {hints.map((hint, i) => (
                      <div
                        key={i}
                        className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 dark:border-amber-800 dark:bg-amber-950"
                      >
                        <p className="text-xs font-medium text-amber-800 dark:text-amber-200">
                          {hint.message}
                        </p>
                        <p className="text-xs text-amber-700 dark:text-amber-300 mt-0.5">
                          {hint.detail}
                        </p>
                      </div>
                    ))}
                  </div>
                );
              })()}
            </div>
          </div>

          <div className="my-6 border-t border-border" />

          <MaterialPicker
            quotes={quotes}
            shipping={shipping}
            sortQuantity={sortQuantity}
            quotesLoading={loadingPhase === "quoting"}
            quotesPartial={loadingPhase === "timeout"}
            viableMaterials={viableMaterials}
            onRetryQuotes={() => {
              setLoadingPhase(isDraft ? "quoting" : "uploading");
              fetchQuotes().catch((err) => {
                setError(err instanceof Error ? err.message : "Something went wrong");
                setLoadingPhase("done");
              });
            }}
            selectedQuote={selectedQuote}
            onSelectQuote={setSelectedQuote}
            preselectMaterialId={preselectMaterialId}
            preselectFinishGroupId={preselectFinishGroupId}
            onClearPreselectScope={() => setScopedMaterialId(null)}
          />
        </div>

        <div className="lg:sticky lg:top-6 space-y-4">
          <PriceDisplay
            selectedQuote={selectedQuote}
            shipping={shipping}
            selectedShipping={selectedShipping}
            onSelectShipping={setSelectedShipping}
            quantity={quantity}
            onCheckout={handleCheckout}
            isCheckingOut={isCheckingOut}
            checkoutError={checkoutError}
            onAddToCart={
              // Add to Cart needs a cart it can actually write to: the
              // local cart (draftMode, holds the in-memory file) or the
              // DB cart (signed-in users). An anon user on a published
              // file has neither — they go straight to the sign-up
              // checkout via Proceed to checkout instead.
              (draftMode || (fileAssetId && isSignedIn)) && cart
                ? handleAddToCart
                : undefined
            }
            isAddingToCart={isAddingToCart}
            minimumFeeInfo={minimumFeeInfo}
            checkingMinimum={checkingMinimum}
            shippingLocked={!!lockedShippingOption}
            shippingLockedNotice={
              lockedShippingOption && selectedQuote
                ? `Shipping matches your ${selectedQuote.vendorName} cart`
                : null
            }
            checkoutModel={checkoutModel}
          />
          {rightAnnex?.({ pendingItem })}
        </div>
      </div>
    </div>
  );
}
