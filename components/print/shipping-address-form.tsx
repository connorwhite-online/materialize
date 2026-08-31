"use client";

import { useEffect, useRef, useState } from "react";
import { MailOpenIcon, MapPinIcon, PackageIcon, TruckIcon } from "lucide-react";
import { useSignUp, useSignIn } from "@clerk/nextjs/legacy";
import { setUsernameFromEmail } from "@/app/actions/onboarding";
import { reportClientError } from "@/lib/observability/report-client-error";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CheckboxField } from "@/components/ui/checkbox";
import { Card, CardContent } from "@/components/ui/card";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp";
import { ChevronLeft } from "@/components/icons/chevron-left";

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
  const [billingSame, setBillingSame] = useState(true);
  const [billing, setBilling] = useState<Address>({
    firstName: "",
    lastName: "",
    address: "",
    city: "",
    zipCode: "",
    countryCode: "US",
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
    if (!email || !email.includes("@")) errs.email = "Valid email required";
    if (!shipping.firstName) errs.firstName = "Required";
    if (!shipping.lastName) errs.lastName = "Required";
    if (!shipping.address) errs.address = "Required";
    if (!shipping.city) errs.city = "Required";
    if (!shipping.zipCode) errs.zipCode = "Required";
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

    const billingAddress = billingSame ? shipping : billing;
    const payload = {
      email,
      shipping,
      billing: { ...billingAddress, isCompany: false },
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

  const updateShipping = (field: keyof Address, value: string) => {
    setShipping((prev) => ({ ...prev, [field]: value }));
    if (errors[field]) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next[field];
        return next;
      });
    }
  };

  // One-tap path for returning buyers: their last-used address as a
  // chunky card. The payload skips validate() — it already passed the
  // same checks when it was originally submitted (and
  // getSavedShippingAddress re-checks the required fields).
  if (stage === "saved" && savedAddress) {
    const { shipping: saved } = savedAddress;
    const body = (
      <div className="space-y-4">
        {!embedded && (
          <div className="flex flex-row items-center gap-3">
            <IconTile tone="bg-green-100 text-green-600 dark:bg-green-950 dark:text-green-400">
              <PackageIcon className="h-6 w-6" strokeWidth={2.5} />
            </IconTile>
            <div>
              <h2
                ref={titleRef}
                tabIndex={-1}
                className="text-base font-semibold outline-none"
              >
                Ship it to the usual?
              </h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                We kept your address from last time.
              </p>
            </div>
          </div>
        )}
        {embedded && (
          <div>
            <EmbeddedSheetBack onClick={onBack} disabled={isSubmitting} />
            <h2
              ref={titleRef}
              tabIndex={-1}
              className="mt-2 text-lg font-semibold outline-none"
            >
              Ship it to the usual?
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              We kept your address from last time.
            </p>
          </div>
        )}
        <div className="flex items-start gap-3 rounded-2xl border border-border/60 p-4">
          <IconTile tone="bg-blue-100 text-blue-600 dark:bg-blue-950 dark:text-blue-400">
            <MapPinIcon className="h-5 w-5" strokeWidth={2.5} />
          </IconTile>
          <div className="min-w-0 text-sm">
            <p className="font-medium">
              {saved.firstName} {saved.lastName}
            </p>
            <p className="text-muted-foreground">
              {saved.address}
              {saved.addressLine2 ? `, ${saved.addressLine2}` : ""}
            </p>
            <p className="text-muted-foreground">
              {saved.city}
              {saved.stateCode ? `, ${saved.stateCode}` : ""} {saved.zipCode} ·{" "}
              {saved.countryCode}
            </p>
            <p className="mt-1 truncate text-xs text-muted-foreground">
              {savedAddress.email}
            </p>
          </div>
        </div>

        <div className="space-y-3">
          <Button
            type="button"
            className="w-full"
            disabled={isSubmitting}
            onClick={() => onSubmit(savedAddress)}
          >
            <TruckIcon
              className="mr-2 h-4 w-4"
              strokeWidth={2.5}
              aria-hidden="true"
            />
            {isSubmitting ? "Processing..." : "Deliver to this address"}
          </Button>
          <button
            type="button"
            onClick={() => setStage("form")}
            disabled={isSubmitting}
            className="block w-full text-center text-xs text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
          >
            Use a different address
          </button>
        </div>
      </div>
    );

    if (embedded) return <div>{body}</div>;

    return (
      <div>
        <Card>
          <CardContent className="pt-6">{body}</CardContent>
        </Card>
        <div className="mt-6">
          <Button
            type="button"
            variant="outline"
            onClick={onBack}
            disabled={isSubmitting}
          >
            Back
          </Button>
        </div>
      </div>
    );
  }

  if (stage === "code") {
    const codeBody = (
      <div className="space-y-4">
        {embedded ? (
          <div>
            <EmbeddedSheetBack
              onClick={onBack}
              disabled={otpVerifying || isSubmitting}
            />
            <h2
              ref={titleRef}
              tabIndex={-1}
              className="mt-2 text-lg font-semibold outline-none"
            >
              Verify your email
            </h2>
          </div>
        ) : (
          <div className="flex flex-row items-center gap-3">
            <IconTile tone="bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400">
              <MailOpenIcon className="h-6 w-6" strokeWidth={2.5} />
            </IconTile>
            <h2
              ref={titleRef}
              tabIndex={-1}
              className="text-base font-semibold outline-none"
            >
              Verify your email
            </h2>
          </div>
        )}
        <p className="text-sm text-muted-foreground">
          We sent a 6-digit code to{" "}
          <span className="font-medium text-foreground">{email}</span>.{" "}
          {authFlow === "sign-up"
            ? "Enter it to finish setting up your account and place your order."
            : "Looks like you already have an account — enter the code to sign in and place your order."}
        </p>
        <div className="flex justify-center">
          <InputOTP
            maxLength={6}
            value={otpCode}
            onChange={(val) => {
              setOtpCode(val);
              if (val.length === 6) handleVerifyOtp(val);
            }}
            autoFocus
            disabled={otpVerifying || isSubmitting}
            aria-label="6-digit verification code"
            aria-invalid={!!otpError}
            aria-describedby={otpError ? "otp-error" : undefined}
          >
            <InputOTPGroup>
              <InputOTPSlot index={0} />
              <InputOTPSlot index={1} />
              <InputOTPSlot index={2} />
              <InputOTPSlot index={3} />
              <InputOTPSlot index={4} />
              <InputOTPSlot index={5} />
            </InputOTPGroup>
          </InputOTP>
        </div>
        {otpError && (
          <p
            id="otp-error"
            role="alert"
            className="text-center text-xs text-destructive"
          >
            {otpError}
          </p>
        )}
        {(otpVerifying || isSubmitting) && (
          <p role="status" className="text-center text-xs text-muted-foreground">
            {isSubmitting ? "Placing your order…" : "Verifying…"}
          </p>
        )}
        <button
          type="button"
          onClick={() => {
            setStage("form");
            setOtpCode("");
            setOtpError("");
            setPendingSubmission(null);
          }}
          disabled={otpVerifying || isSubmitting}
          className="block w-full text-center text-xs text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
        >
          Use a different email
        </button>
      </div>
    );
    if (embedded) return <div>{codeBody}</div>;
    return (
      <Card>
        <CardContent className="pt-6">{codeBody}</CardContent>
      </Card>
    );
  }

  const formFields = (
          <div className="space-y-4">
        {embedded ? (
          <div>
            <EmbeddedSheetBack
              onClick={onBack}
              disabled={isSubmitting || otpSending}
            />
            <h2
              ref={titleRef}
              tabIndex={-1}
              className="mt-2 text-lg font-semibold outline-none"
            >
              Where should we ship?
            </h2>
          </div>
        ) : (
          <div className="flex flex-row items-center gap-3">
            <IconTile tone="bg-blue-100 text-blue-600 dark:bg-blue-950 dark:text-blue-400">
              <TruckIcon className="h-6 w-6" strokeWidth={2.5} />
            </IconTile>
            <h2
              ref={titleRef}
              tabIndex={-1}
              className="text-base font-semibold outline-none"
            >
              Shipping Address
            </h2>
          </div>
        )}
          <div>
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              aria-required="true"
              aria-invalid={!!errors.email}
              aria-describedby={errors.email ? "email-error" : undefined}
            />
            {errors.email && (
              <p id="email-error" className="mt-1 text-xs text-destructive">{errors.email}</p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="firstName">First Name</Label>
              <Input
                id="firstName"
                value={shipping.firstName}
                onChange={(e) => updateShipping("firstName", e.target.value)}
                aria-required="true"
                aria-invalid={!!errors.firstName}
                aria-describedby={errors.firstName ? "firstName-error" : undefined}
              />
              {errors.firstName && (
                <p id="firstName-error" className="mt-1 text-xs text-destructive">{errors.firstName}</p>
              )}
            </div>
            <div>
              <Label htmlFor="lastName">Last Name</Label>
              <Input
                id="lastName"
                value={shipping.lastName}
                onChange={(e) => updateShipping("lastName", e.target.value)}
                aria-required="true"
                aria-invalid={!!errors.lastName}
                aria-describedby={errors.lastName ? "lastName-error" : undefined}
              />
              {errors.lastName && (
                <p id="lastName-error" className="mt-1 text-xs text-destructive">{errors.lastName}</p>
              )}
            </div>
          </div>

          <div>
            <Label htmlFor="address">Address</Label>
            <Input
              id="address"
              value={shipping.address}
              onChange={(e) => updateShipping("address", e.target.value)}
              placeholder="123 Main St"
              aria-required="true"
              aria-invalid={!!errors.address}
              aria-describedby={errors.address ? "address-error" : undefined}
            />
            {errors.address && (
              <p id="address-error" className="mt-1 text-xs text-destructive">{errors.address}</p>
            )}
          </div>

          <div>
            <Label htmlFor="addressLine2">Address Line 2 (optional)</Label>
            <Input
              id="addressLine2"
              value={shipping.addressLine2}
              onChange={(e) => updateShipping("addressLine2", e.target.value)}
              placeholder="Apt, suite, etc."
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="city">City</Label>
              <Input
                id="city"
                value={shipping.city}
                onChange={(e) => updateShipping("city", e.target.value)}
                aria-required="true"
                aria-invalid={!!errors.city}
                aria-describedby={errors.city ? "city-error" : undefined}
              />
              {errors.city && (
                <p id="city-error" className="mt-1 text-xs text-destructive">{errors.city}</p>
              )}
            </div>
            <div>
              <Label htmlFor="zipCode">Postal Code</Label>
              <Input
                id="zipCode"
                value={shipping.zipCode}
                onChange={(e) => updateShipping("zipCode", e.target.value)}
                aria-required="true"
                aria-invalid={!!errors.zipCode}
                aria-describedby={errors.zipCode ? "zipCode-error" : undefined}
              />
              {errors.zipCode && (
                <p id="zipCode-error" className="mt-1 text-xs text-destructive">{errors.zipCode}</p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="stateCode">State/Province (optional)</Label>
              <Input
                id="stateCode"
                value={shipping.stateCode}
                onChange={(e) => updateShipping("stateCode", e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="countryCode">Country</Label>
              <select
                id="countryCode"
                value={shipping.countryCode}
                onChange={(e) => updateShipping("countryCode", e.target.value)}
                className="flex h-9 w-full rounded-lg border border-input bg-background px-3 py-1 text-sm shadow-xs"
              >
                {COUNTRIES.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <Label htmlFor="phone">Phone (optional)</Label>
            <Input
              id="phone"
              type="tel"
              value={shipping.phoneNumber}
              onChange={(e) => updateShipping("phoneNumber", e.target.value)}
            />
          </div>

          <div className="pt-2">
            <CheckboxField
              id="billingSame"
              checked={billingSame}
              onCheckedChange={(checked) => setBillingSame(checked === true)}
              label="Billing address same as shipping"
            />
          </div>
          </div>
  );

  return (
    <form ref={formRef} onSubmit={handleSubmit}>
      {embedded ? (
        formFields
      ) : (
        <Card>
          <CardContent className="pt-6">{formFields}</CardContent>
        </Card>
      )}

      {anonMode && otpError && stage === "form" && (
        <p role="alert" className="mt-3 text-xs text-destructive">
          {otpError}
        </p>
      )}

      <div className="mt-6 flex gap-3">
        {!embedded && (
          <Button
            type="button"
            variant="outline"
            onClick={onBack}
            disabled={isSubmitting || otpSending}
          >
            Back
          </Button>
        )}
        <Button
          type="submit"
          disabled={isSubmitting || otpSending}
          className="flex-1"
        >
          {otpSending
            ? "Sending code…"
            : isSubmitting
              ? "Processing..."
              : anonMode
                ? "Continue"
                : "Place Order & Pay"}
        </Button>
      </div>
    </form>
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
      className="inline-flex cursor-pointer items-center gap-1 rounded-lg px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground disabled:pointer-events-none disabled:opacity-50 -ml-3"
    >
      <ChevronLeft size={14} />
      Shipping
    </button>
  );
}

/**
 * Chunky rounded icon tile — the checkout flow's shared visual accent
 * (also used by the fee sheets and the sandbox CraftCloud page).
 */
function IconTile({
  tone,
  children,
}: {
  tone: string;
  children: React.ReactNode;
}) {
  return (
    <div
      aria-hidden="true"
      className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${tone}`}
    >
      {children}
    </div>
  );
}
