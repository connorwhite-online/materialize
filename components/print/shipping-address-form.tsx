"use client";

import { useEffect, useRef, useState } from "react";
import { MapPinIcon } from "lucide-react";
import { useSignUp, useSignIn } from "@clerk/nextjs/legacy";
import { setUsernameFromEmail } from "@/app/actions/onboarding";
import { reportClientError } from "@/lib/observability/report-client-error";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FormActions } from "@/components/ui/field";
import { OtpField } from "@/components/ui/otp-field";
import { ChevronLeft } from "@/components/icons/chevron-left";
import { ChevronDown } from "@/components/icons/chevron-down";
import { cn } from "@/lib/utils";

interface Address {
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
}

/**
 * A previously used checkout address (the newest
 * printOrders.shippingAddress for the signed-in user — see
 * getSavedShippingAddress). Rendered as a one-tap "deliver here"
 * card before the full form; also prefills the form when the user
 * opts to edit instead.
 */
export interface SavedCheckoutAddress {
  email: string;
  shipping: Address;
  billing: Address & { isCompany: boolean; vatId?: string };
}

interface ShippingAddressFormProps {
  onSubmit: (data: {
    email: string;
    shipping: Address;
    billing: Address & { isCompany: boolean; vatId?: string };
  }) => void;
  onBack: () => void;
  isSubmitting: boolean;
  /**
   * When true, the email the user enters becomes a Clerk sign-up.
   * On submit we create the account, prepare the email-code
   * verification, and show an inline OTP step inside the form
   * before calling `onSubmit`. The parent never sees the OTP — it
   * just gets a resolved sign-in before its onSubmit fires.
   */
  anonMode?: boolean;
  /**
   * Last-used address for returning buyers. When set, the form opens
   * on a "deliver to this address" card (one tap re-orders to the
   * same place) with the full form one step away, prefilled. Never
   * passed in anon mode — there's no history to draw from.
   */
  savedAddress?: SavedCheckoutAddress | null;
  /**
   * Sheet chrome: drop the Card wrappers / icon tiles (the parent
   * sheet already provides the surface) and surface step-back as a
   * top-left chevron ("← Shipping") instead of a bottom text button.
   * Used by ShippingSheet's address step.
   */
  embedded?: boolean;
}

const COUNTRIES = [
  { code: "US", name: "United States" },
  { code: "CA", name: "Canada" },
  { code: "GB", name: "United Kingdom" },
  { code: "DE", name: "Germany" },
  { code: "FR", name: "France" },
  { code: "NL", name: "Netherlands" },
  { code: "AU", name: "Australia" },
  { code: "JP", name: "Japan" },
  { code: "CH", name: "Switzerland" },
  { code: "NO", name: "Norway" },
];

// Fields that carry a required attribute and can receive focus on
// failed submit. Matches the validate() checks below.
const REQUIRED_FIELD_IDS = [
  "email",
  "firstName",
  "lastName",
  "address",
  "city",
  "zipCode",
  "phoneNumber",
] as const;

export function ShippingAddressForm({
  onSubmit,
  onBack,
  isSubmitting,
  anonMode = false,
  savedAddress = null,
  embedded = false,
}: ShippingAddressFormProps) {
  const {
    isLoaded: signUpLoaded,
    signUp,
    setActive: setActiveFromSignUp,
  } = useSignUp();
  const {
    isLoaded: signInLoaded,
    signIn,
    setActive: setActiveFromSignIn,
  } = useSignIn();
  // "saved" → returning buyer: one-tap card for their last address.
  // "form" → the user is filling in shipping details.
  // "code" → we sent an OTP and are waiting for the 6-digit code.
  // After the code verifies we call onSubmit and the parent swaps us
  // out for its processing UI.
  // Initial stage is decided at mount — a savedAddress that resolves
  // after the user already started typing must not yank the form away.
  const [stage, setStage] = useState<"saved" | "form" | "code">(() =>
    savedAddress && !anonMode ? "saved" : "form"
  );
  // Which Clerk primitive sent the OTP. A brand-new email goes
  // through `signUp`; an existing account pivots to `signIn` with
  // an email-code first factor. Same UX either way.
  const [authFlow, setAuthFlow] = useState<"sign-up" | "sign-in">("sign-up");
  const [otpCode, setOtpCode] = useState("");
  const [otpError, setOtpError] = useState("");
  const [otpSending, setOtpSending] = useState(false);
  const [otpVerifying, setOtpVerifying] = useState(false);
  // Stash the fully-validated form data while the user is in the OTP
  // step so we can replay it into `onSubmit` as soon as they verify.
  const [pendingSubmission, setPendingSubmission] = useState<{
    email: string;
    shipping: Address;
    billing: Address & { isCompany: boolean; vatId?: string };
  } | null>(null);

  // Prefill from the saved address so "Use a different address" opens
  // an edit of the last one instead of a blank slate.
  const [email, setEmail] = useState(savedAddress?.email ?? "");
  const [shipping, setShipping] = useState<Address>({
    firstName: "",
    lastName: "",
    address: "",
    addressLine2: "",
    city: "",
    zipCode: "",
    stateCode: "",
    countryCode: "US",
    phoneNumber: "",
    ...savedAddress?.shipping,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Ref used to focus the first invalid field on failed submit (CON-149).
  const formRef = useRef<HTMLFormElement>(null);

  // Focus the step heading on mount AND on stage changes (saved →
  // form → code) so step transitions land AT users on the new step
  // heading (CON-157).
  const titleRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    titleRef.current?.focus();
  }, [stage]);

  const validate = () => {
    const errs: Record<string, string> = {};
    if (!email || !email.includes("@")) errs.email = "Enter a valid email address";
    if (!shipping.firstName) errs.firstName = "Enter a first name";
    if (!shipping.lastName) errs.lastName = "Enter a last name";
    if (!shipping.address) errs.address = "Enter a street address";
    if (!shipping.city) errs.city = "Enter a city";
    if (!shipping.zipCode) errs.zipCode = "Enter a postal code";
    if ((shipping.phoneNumber ?? "").replace(/\D/g, "").length < 7) {
      errs.phoneNumber = "Enter a phone number";
    }
    setErrors(errs);
    return errs;
  };

  /** Move focus to the first invalid field so keyboard/SR users land on it. */
  const focusFirstError = (errs: Record<string, string>) => {
    for (const id of REQUIRED_FIELD_IDS) {
      if (errs[id]) {
        const el = formRef.current?.querySelector<HTMLElement>(`#${id}`);
        el?.focus();
        break;
      }
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length > 0) {
      focusFirstError(errs);
      return;
    }

    // Billing mirrors shipping. There used to be a "billing same as
    // shipping" checkbox, but unticking it never revealed billing
    // fields — it just sent CraftCloud an empty billing address. The
    // card's own billing details are collected by Stripe.
    const payload = {
      email,
      shipping,
      billing: { ...shipping, isCompany: false },
    };

    // Authed path — just hand the parent the data and let it drive
    // createPrintOrder / completePrintOrder the way it always has.
    if (!anonMode) {
      onSubmit(payload);
      return;
    }

    // Anon path — try creating a Clerk sign-up from the email. If
    // the email is already tied to an account we pivot to a sign-in
    // email-code first factor instead, so the checkout still works
    // for returning users who forgot they had an account.
    if (!signUpLoaded || !signUp || !signInLoaded || !signIn) return;
    setOtpSending(true);
    setOtpError("");
    try {
      try {
        await signUp.create({ emailAddress: email });
        await signUp.prepareEmailAddressVerification({
          strategy: "email_code",
        });
        setAuthFlow("sign-up");
      } catch (err: unknown) {
        const clerkErr = err as {
          errors?: Array<{ code?: string; longMessage?: string }>;
        };
        const existing = clerkErr.errors?.some(
          (e) => e.code === "form_identifier_exists"
        );
        if (!existing) throw err;

        // Pivot to sign-in email-code flow.
        const attempt = await signIn.create({ identifier: email });
        const emailFactor = attempt.supportedFirstFactors?.find(
          (f): f is typeof f & { emailAddressId: string } =>
            f.strategy === "email_code" && "emailAddressId" in f
        );
        if (!emailFactor) {
          throw new Error(
            "This email already has an account, but email-code sign-in isn't available."
          );
        }
        await signIn.prepareFirstFactor({
          strategy: "email_code",
          emailAddressId: emailFactor.emailAddressId,
        });
        setAuthFlow("sign-in");
      }

      setPendingSubmission(payload);
      setStage("code");
    } catch (err: unknown) {
      const clerkErr = err as { errors?: Array<{ longMessage?: string }> };
      setOtpError(
        clerkErr.errors?.[0]?.longMessage ||
          (err instanceof Error
            ? err.message
            : "Could not send verification code")
      );
    } finally {
      setOtpSending(false);
    }
  };

  const handleVerifyOtp = async (codeValue: string) => {
    if (codeValue.length < 6) return;
    if (!pendingSubmission) return;
    if (authFlow === "sign-up" && (!signUpLoaded || !signUp)) return;
    if (authFlow === "sign-in" && (!signInLoaded || !signIn)) return;
    setOtpVerifying(true);
    setOtpError("");
    try {
      const result =
        authFlow === "sign-up"
          ? await signUp!.attemptEmailAddressVerification({ code: codeValue })
          : await signIn!.attemptFirstFactor({
              strategy: "email_code",
              code: codeValue,
            });

      if (result.status === "complete" && result.createdSessionId) {
        const activate =
          authFlow === "sign-up" ? setActiveFromSignUp : setActiveFromSignIn;
        if (!activate) throw new Error("Clerk session not ready");
        await activate({ session: result.createdSessionId });

        // Brand-new accounts have no username yet — auto-provision
        // one from the email local-part so their dashboard isn't
        // broken after checkout. Best-effort: a failure here must
        // not block the order.
        if (authFlow === "sign-up") {
          try {
            await setUsernameFromEmail(pendingSubmission.email);
          } catch (err) {
            // Non-fatal — the user can rename from settings later,
            // but report so a broad failure isn't invisible.
            reportClientError("checkout.set-username-failed", err);
          }
        }

        // Hand the stashed payload to the parent. Its onSubmit now
        // runs with an authed session, so the server actions it
        // calls will succeed.
        onSubmit(pendingSubmission);
        return;
      }
      // Sign-in has no `missingFields` / `unverifiedFields` shape —
      // fall back to a generic message there.
      const signUpDetails =
        authFlow === "sign-up"
          ? [
              "missingFields" in result &&
                result.missingFields?.length &&
                `Missing: ${result.missingFields.join(", ")}`,
              "unverifiedFields" in result &&
                result.unverifiedFields?.length &&
                `Unverified: ${result.unverifiedFields.join(", ")}`,
            ]
              .filter(Boolean)
              .join(" · ")
          : "";
      setOtpError(signUpDetails || `Verification incomplete (${result.status})`);
    } catch (err: unknown) {
      const clerkErr = err as { errors?: Array<{ longMessage?: string }> };
      setOtpError(
        clerkErr.errors?.[0]?.longMessage ||
          (err instanceof Error ? err.message : "Invalid code")
      );
      setOtpCode("");
    } finally {
      setOtpVerifying(false);
    }
  };

  // handleVerifyOtp closes over pendingSubmission/signUp/signIn and is
  // redefined every render, so the clipboard effect below reads it
  // through a ref instead of taking it as a dependency (which would
  // tear the focus/visibilitychange listeners down and rebuild them
  // on every keystroke elsewhere in the tree).
  const handleVerifyOtpRef = useRef(handleVerifyOtp);
  useEffect(() => {
    handleVerifyOtpRef.current = handleVerifyOtp;
  });

  const fillCodeFromClipboard = (text: string) => {
    const match = text.trim().match(/^\d{6}$/);
    if (!match) return false;
    setOtpCode(match[0]);
    handleVerifyOtpRef.current(match[0]);
    return true;
  };

  // Auto-detect: whenever the tab regains focus (the user switching
  // back from Mail), check the clipboard for a 6-digit code and
  // submit it immediately. This is much faster than Apple's own "code
  // from email" keyboard suggestion, which is frequently delayed by
  // up to a minute. Safari only allows `readText()` to run inside a
  // direct user gesture (a click/tap), so it rejects this silently on
  // iOS — there's no button fallback, so those users still fall back
  // to typing the code by hand. This effect is the reliable path on
  // Chrome/Android, where no gesture is required.
  useEffect(() => {
    if (stage !== "code") return;
    if (typeof navigator === "undefined" || !navigator.clipboard?.readText) {
      return;
    }
    let lastChecked: string | null = null;
    const check = async () => {
      try {
        const text = await navigator.clipboard.readText();
        if (text === lastChecked) return;
        lastChecked = text;
        fillCodeFromClipboard(text);
      } catch {
        // No permission, or not inside a user gesture (Safari) —
        // fail silently; the user can still type the code by hand.
      }
    };
    const onFocus = () => void check();
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void check();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibilityChange);
    void check();
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [stage]);

  const clearError = (field: string) => {
    if (!errors[field]) return;
    setErrors((prev) => {
      const next = { ...prev };
      delete next[field];
      return next;
    });
  };

  const updateShipping = (field: keyof Address, value: string) => {
    setShipping((prev) => ({ ...prev, [field]: value }));
    clearError(field);
  };

  /** Props shared by every validated text input: a11y wiring + error ring. */
  const fieldProps = (id: string) => ({
    id,
    name: id,
    "aria-invalid": !!errors[id],
    "aria-describedby": errors[id] ? `${id}-error` : undefined,
  });

  /** Field error with an id the input's aria-describedby can point at. */
  const errorFor = (id: string) =>
    errors[id] ? <span id={`${id}-error`}>{errors[id]}</span> : undefined;

  // Step header. Embedded (sheet) gets the "← Shipping" back chip above
  // a sheet title; on a page the PageHeader above already names the
  // step, so the form leads with its first section heading instead.
  const stepHeader = (
    title: string,
    description?: React.ReactNode,
    backDisabled?: boolean
  ) =>
    embedded ? (
      <div>
        <EmbeddedSheetBack onClick={onBack} disabled={backDisabled} />
        <h2
          ref={titleRef}
          tabIndex={-1}
          className="mt-2 text-lg leading-6 font-semibold outline-none"
        >
          {title}
        </h2>
        {description && (
          <p className="mt-1 text-sm text-pretty text-muted-foreground">
            {description}
          </p>
        )}
      </div>
    ) : (
      <div>
        <h2
          ref={titleRef}
          tabIndex={-1}
          className="text-base leading-6 font-semibold outline-none"
        >
          {title}
        </h2>
        {description && (
          <p className="mt-0.5 text-sm text-pretty text-muted-foreground">
            {description}
          </p>
        )}
      </div>
    );

  // One-tap path for returning buyers: their last-used address as a
  // selectable object. The payload skips validate() — it already passed
  // the same checks when it was originally submitted (and
  // getSavedShippingAddress re-checks the required fields).
  if (stage === "saved" && savedAddress) {
    const { shipping: saved } = savedAddress;
    const deliver = (
      <Button
        type="button"
        size={embedded ? "lg" : "default"}
        className={embedded ? "w-full" : undefined}
        loading={isSubmitting}
        onClick={() => onSubmit(savedAddress)}
      >
        Deliver to this address
      </Button>
    );
    const different = (
      <Button
        type="button"
        variant={embedded ? "ghost" : "secondary"}
        size={embedded ? "lg" : "default"}
        className={embedded ? "w-full text-muted-foreground" : undefined}
        onClick={() => setStage("form")}
        disabled={isSubmitting}
      >
        Use a different address
      </Button>
    );

    return (
      <div className="flex flex-col gap-5">
        {stepHeader(
          "Ship it to the usual?",
          "We kept your address from last time.",
          isSubmitting
        )}

        <div className="flex items-start gap-3 rounded-2xl px-4 py-3.5 ring-1 ring-border">
          <span
            aria-hidden="true"
            className="flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-muted text-foreground"
          >
            <MapPinIcon className="size-4" />
          </span>
          <div className="min-w-0 text-sm leading-5">
            <p className="font-medium">
              {saved.firstName} {saved.lastName}
            </p>
            <p className="text-muted-foreground">
              {saved.address}
              {saved.addressLine2 ? `, ${saved.addressLine2}` : ""}
            </p>
            <p className="text-muted-foreground">
              {saved.city}
              {saved.stateCode ? `, ${saved.stateCode}` : ""} {saved.zipCode}{" "}
              · {saved.countryCode}
            </p>
            <p className="mt-1 truncate text-[13px] leading-[18px] text-subtle-foreground">
              {[savedAddress.email, saved.phoneNumber].filter(Boolean).join(" · ")}
            </p>
          </div>
        </div>

        {embedded ? (
          <div className="flex flex-col gap-1">
            {deliver}
            {different}
          </div>
        ) : (
          <FormActions align="between">
            <Button
              type="button"
              variant="ghost"
              onClick={onBack}
              disabled={isSubmitting}
            >
              Back
            </Button>
            <div className="flex flex-wrap gap-2">
              {different}
              {deliver}
            </div>
          </FormActions>
        )}
      </div>
    );
  }

  if (stage === "code") {
    const busy = otpVerifying || isSubmitting;
    return (
      <div className="flex flex-col gap-5">
        {stepHeader(
          "Verify your email",
          <>
            We sent a 6-digit code to{" "}
            <span className="font-medium text-foreground">{email}</span>.{" "}
            {authFlow === "sign-up"
              ? "Enter it to finish setting up your account and place your order."
              : "Looks like you already have an account — enter the code to sign in and place your order."}
          </>,
          busy
        )}
        <div className="flex flex-col items-center gap-2">
          <OtpField
            value={otpCode}
            onChange={(val) => {
              setOtpCode(val);
              if (val.length === 6) handleVerifyOtp(val);
            }}
            autoFocus
            disabled={busy}
            aria-label="6-digit verification code"
            aria-invalid={!!otpError}
            aria-describedby={otpError ? "otp-error" : undefined}
          />
          {otpError && (
            <p
              id="otp-error"
              role="alert"
              className="text-center text-[13px] leading-[18px] text-destructive"
            >
              {otpError}
            </p>
          )}
          {busy && (
            <p
              role="status"
              className="text-center text-[13px] leading-[18px] text-muted-foreground"
            >
              {isSubmitting ? "Placing your order…" : "Verifying…"}
            </p>
          )}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="self-center text-muted-foreground"
          onClick={() => {
            setStage("form");
            setOtpCode("");
            setOtpError("");
            setPendingSubmission(null);
          }}
          disabled={busy}
        >
          Use a different email
        </Button>
      </div>
    );
  }

  const busy = isSubmitting || otpSending;
  const submitLabel = otpSending
    ? "Sending code…"
    : anonMode
      ? "Continue"
      : "Continue to payment";

  return (
    <form
      ref={formRef}
      onSubmit={handleSubmit}
      noValidate
      autoComplete="on"
      className="flex flex-col gap-6"
    >
      {embedded && stepHeader("Where should we ship?", undefined, busy)}

      <FormSection
        title="Contact"
        headingRef={embedded ? undefined : titleRef}
        embedded={embedded}
      >
        <Field
          label="Email"
          htmlFor="email"
          error={errorFor("email")}
          hint={
            anonMode
              ? "We'll email you a code to confirm it and set up your account."
              : "For your receipt and delivery updates."
          }
        >
          <Input
            {...fieldProps("email")}
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="off"
            spellCheck={false}
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              clearError("email");
            }}
            placeholder="you@example.com"
            aria-required="true"
          />
        </Field>
        <Field
          label="Phone"
          htmlFor="phoneNumber"
          error={errorFor("phoneNumber")}
          hint={
            <span id="phoneNumber-hint">
              The print shop&apos;s carrier needs it for delivery.
            </span>
          }
        >
          <Input
            {...fieldProps("phoneNumber")}
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            value={shipping.phoneNumber}
            onChange={(e) => updateShipping("phoneNumber", e.target.value)}
            aria-required="true"
            aria-describedby={
              errors.phoneNumber ? "phoneNumber-error" : "phoneNumber-hint"
            }
          />
        </Field>
      </FormSection>

      <FormSection title="Shipping address" embedded={embedded}>
        <Field label="Country" htmlFor="countryCode">
          <div className="relative">
            <select
              id="countryCode"
              name="countryCode"
              autoComplete="country"
              value={shipping.countryCode}
              onChange={(e) => updateShipping("countryCode", e.target.value)}
              className="field-text h-9 w-full min-w-0 cursor-pointer appearance-none rounded-[10px] border border-input bg-background py-1 pr-9 pl-3 outline-none transition-[border-color,box-shadow] duration-150 ease-out hover:border-foreground/25 focus-visible:border-ring focus-visible:shadow-input-focus md:text-sm"
            >
              {COUNTRIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name}
                </option>
              ))}
            </select>
            <ChevronDown
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 right-3 size-3.5 -translate-y-1/2 text-muted-foreground"
            />
          </div>
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="First name" htmlFor="firstName" error={errorFor("firstName")}>
            <Input
              {...fieldProps("firstName")}
              autoComplete="shipping given-name"
              value={shipping.firstName}
              onChange={(e) => updateShipping("firstName", e.target.value)}
              aria-required="true"
            />
          </Field>
          <Field label="Last name" htmlFor="lastName" error={errorFor("lastName")}>
            <Input
              {...fieldProps("lastName")}
              autoComplete="shipping family-name"
              value={shipping.lastName}
              onChange={(e) => updateShipping("lastName", e.target.value)}
              aria-required="true"
            />
          </Field>
        </div>

        <Field label="Address" htmlFor="address" error={errorFor("address")}>
          <Input
            {...fieldProps("address")}
            autoComplete="shipping address-line1"
            value={shipping.address}
            onChange={(e) => updateShipping("address", e.target.value)}
            placeholder="Street and number"
            aria-required="true"
          />
        </Field>

        <Field label="Apartment, suite, etc." htmlFor="addressLine2" optional>
          <Input
            id="addressLine2"
            name="addressLine2"
            autoComplete="shipping address-line2"
            value={shipping.addressLine2}
            onChange={(e) => updateShipping("addressLine2", e.target.value)}
          />
        </Field>

        {/* City spans the row on phones; at sm+ city / state / postal
            code share one row, the way every address form reads. */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-[1.4fr_0.8fr_1.2fr]">
          <Field
            label="City"
            htmlFor="city"
            error={errorFor("city")}
            className="col-span-2 sm:col-span-1"
          >
            <Input
              {...fieldProps("city")}
              autoComplete="shipping address-level2"
              value={shipping.city}
              onChange={(e) => updateShipping("city", e.target.value)}
              aria-required="true"
            />
          </Field>
          <Field label="State" htmlFor="stateCode">
            <Input
              id="stateCode"
              name="stateCode"
              autoComplete="shipping address-level1"
              value={shipping.stateCode}
              onChange={(e) => updateShipping("stateCode", e.target.value)}
            />
          </Field>
          <Field label="Postal code" htmlFor="zipCode" error={errorFor("zipCode")}>
            <Input
              {...fieldProps("zipCode")}
              autoComplete="shipping postal-code"
              value={shipping.zipCode}
              onChange={(e) => updateShipping("zipCode", e.target.value)}
              aria-required="true"
            />
          </Field>
        </div>
      </FormSection>

      {anonMode && otpError && (
        <p role="alert" className="-mt-2 text-[13px] leading-[18px] text-destructive">
          {otpError}
        </p>
      )}

      {embedded ? (
        <Button type="submit" size="lg" className="w-full" loading={busy}>
          {submitLabel}
        </Button>
      ) : (
        <FormActions align="between">
          <Button type="button" variant="ghost" onClick={onBack} disabled={busy}>
            Back
          </Button>
          <Button type="submit" size="lg" loading={busy}>
            {submitLabel}
          </Button>
        </FormActions>
      )}
    </form>
  );
}

/**
 * A titled group of fields (Contact, Shipping address). Grouped by a
 * heading and space, not a box — the form isn't an object.
 */
function FormSection({
  title,
  headingRef,
  embedded,
  children,
}: {
  title: string;
  headingRef?: React.Ref<HTMLHeadingElement>;
  embedded: boolean;
  children: React.ReactNode;
}) {
  const Heading = embedded ? "h3" : "h2";
  return (
    <section className="flex flex-col gap-4">
      <Heading
        ref={headingRef}
        tabIndex={headingRef ? -1 : undefined}
        className={cn(
          "font-semibold outline-none",
          embedded ? "text-sm leading-5" : "text-base leading-6"
        )}
      >
        {title}
      </Heading>
      {children}
    </section>
  );
}

/**
 * Top-left step-back control for the embedded checkout sheet.
 * Mirrors material-picker's "← All materials" — chevron + destination,
 * not a second muted text button under the primary CTA.
 */
function EmbeddedSheetBack({
  onClick,
  disabled,
}: {
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="-ml-2 inline-flex h-8 cursor-pointer items-center gap-1 rounded-lg pr-2.5 pl-1.5 text-sm text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50"
    >
      <ChevronLeft size={14} />
      Shipping
    </button>
  );
}
