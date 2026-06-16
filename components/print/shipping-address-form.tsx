"use client";

import { useEffect, useRef, useState } from "react";
import { useSignUp, useSignIn } from "@clerk/nextjs/legacy";
import { setUsernameFromEmail } from "@/app/actions/onboarding";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CheckboxField } from "@/components/ui/checkbox";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp";

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
  // "form" → the user is filling in shipping details.
  // "code" → we sent an OTP and are waiting for the 6-digit code.
  // After the code verifies we call onSubmit and the parent swaps us
  // out for its processing UI.
  const [stage, setStage] = useState<"form" | "code">("form");
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

  const [email, setEmail] = useState("");
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

  // Focus the "Shipping Address" heading on mount so step transitions
  // land AT users on the new step heading (CON-157).
  const titleRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    titleRef.current?.focus();
  }, []);

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
          } catch {
            // Swallow — the user can rename from settings later.
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

  if (stage === "code") {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Verify your email</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
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
            <p id="otp-error" role="alert" className="text-xs text-destructive text-center">
              {otpError}
            </p>
          )}
          {(otpVerifying || isSubmitting) && (
            <p
              role="status"
              className="text-xs text-muted-foreground text-center"
            >
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
        </CardContent>
      </Card>
    );
  }

  return (
    <form ref={formRef} onSubmit={handleSubmit}>
      <Card>
        <CardHeader>
          <CardTitle ref={titleRef} tabIndex={-1} className="outline-none">Shipping Address</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
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
        </CardContent>
      </Card>

      {anonMode && otpError && stage === "form" && (
        <p role="alert" className="mt-3 text-xs text-destructive">
          {otpError}
        </p>
      )}

      <div className="mt-6 flex gap-3">
        <Button
          type="button"
          variant="outline"
          onClick={onBack}
          disabled={isSubmitting || otpSending}
        >
          Back
        </Button>
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
