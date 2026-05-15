// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react";

// input-otp leans on browser APIs jsdom doesn't ship — ResizeObserver
// at mount and a late-firing pointer heuristic via
// document.elementFromPoint. Neither is used by the assertions; no-op
// stubs are enough and keep the run free of unhandled rejections.
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}
if (typeof document !== "undefined" && !document.elementFromPoint) {
  document.elementFromPoint = () => null;
}

// ShippingAddressForm hosts the inline OTP sign-up that AGENTS.md
// flags as the most fragile revenue path: anon users walk the print
// quote flow, type their email on the shipping form, get an OTP, and
// the parent's onSubmit (which drives R2 → draftFile → printOrder →
// Stripe) only runs after Clerk's setActive resolves. The full e2e
// path is blocked behind the mock CraftCloud catalog mismatch, so
// these tests exercise the state machine directly with Clerk mocked.

// Programmable Clerk call surfaces. Reassigning the underlying spies
// per test keeps assertions readable while letting tests override
// individual call outcomes (e.g. "signUp.create throws
// form_identifier_exists").
const calls = {
  signUpCreate: vi.fn(),
  signUpPrepare: vi.fn(),
  signUpAttempt: vi.fn(),
  setActiveFromSignUp: vi.fn(),
  signInCreate: vi.fn(),
  signInPrepare: vi.fn(),
  signInAttempt: vi.fn(),
  setActiveFromSignIn: vi.fn(),
};

vi.mock("@clerk/nextjs/legacy", () => ({
  useSignUp: () => ({
    isLoaded: true,
    signUp: {
      create: (args: unknown) => calls.signUpCreate(args),
      prepareEmailAddressVerification: (args: unknown) =>
        calls.signUpPrepare(args),
      attemptEmailAddressVerification: (args: unknown) =>
        calls.signUpAttempt(args),
    },
    setActive: (args: unknown) => calls.setActiveFromSignUp(args),
  }),
  useSignIn: () => ({
    isLoaded: true,
    signIn: {
      create: (args: unknown) => calls.signInCreate(args),
      prepareFirstFactor: (args: unknown) => calls.signInPrepare(args),
      attemptFirstFactor: (args: unknown) => calls.signInAttempt(args),
    },
    setActive: (args: unknown) => calls.setActiveFromSignIn(args),
  }),
}));

const setUsernameFromEmail = vi.fn();
vi.mock("@/app/actions/onboarding", () => ({
  setUsernameFromEmail: (email: string) => setUsernameFromEmail(email),
}));

import { ShippingAddressForm } from "../shipping-address-form";

function fillRequiredFields() {
  fireEvent.change(screen.getByLabelText("Email"), {
    target: { value: "ada@example.com" },
  });
  fireEvent.change(screen.getByLabelText("First Name"), {
    target: { value: "Ada" },
  });
  fireEvent.change(screen.getByLabelText("Last Name"), {
    target: { value: "Lovelace" },
  });
  fireEvent.change(screen.getByLabelText("Address"), {
    target: { value: "123 Main" },
  });
  fireEvent.change(screen.getByLabelText("City"), {
    target: { value: "London" },
  });
  fireEvent.change(screen.getByLabelText("Postal Code"), {
    target: { value: "NW1 5LR" },
  });
}

// Drives the OTP input that input-otp renders as a single hidden
// <input>. Firing a change with the full 6-char value is enough — the
// form's onChange short-circuits on val.length === 6 and calls
// handleVerifyOtp directly, so we don't need to type per-character.
function enterOtp(code: string) {
  const otpInput = document.querySelector(
    'input[maxlength="6"]'
  ) as HTMLInputElement | null;
  if (!otpInput) throw new Error("OTP input not found");
  fireEvent.input(otpInput, { target: { value: code } });
}

const expectedAnonPayload = {
  email: "ada@example.com",
  shipping: expect.objectContaining({
    firstName: "Ada",
    lastName: "Lovelace",
    address: "123 Main",
    city: "London",
    zipCode: "NW1 5LR",
    countryCode: "US",
  }),
  billing: expect.objectContaining({
    firstName: "Ada",
    lastName: "Lovelace",
    address: "123 Main",
    city: "London",
    zipCode: "NW1 5LR",
    countryCode: "US",
    isCompany: false,
  }),
};

beforeEach(() => {
  vi.clearAllMocks();
  // Sensible happy-path defaults; individual tests override.
  calls.signUpCreate.mockResolvedValue(undefined);
  calls.signUpPrepare.mockResolvedValue(undefined);
  calls.signUpAttempt.mockResolvedValue({
    status: "complete",
    createdSessionId: "sess-up-1",
  });
  calls.setActiveFromSignUp.mockResolvedValue(undefined);
  calls.signInCreate.mockResolvedValue({
    supportedFirstFactors: [
      { strategy: "email_code", emailAddressId: "eid-1" },
    ],
  });
  calls.signInPrepare.mockResolvedValue(undefined);
  calls.signInAttempt.mockResolvedValue({
    status: "complete",
    createdSessionId: "sess-in-1",
  });
  calls.setActiveFromSignIn.mockResolvedValue(undefined);
  setUsernameFromEmail.mockResolvedValue(undefined);
});

describe("ShippingAddressForm — authed mode", () => {
  it("submits directly without sending an OTP", async () => {
    const onSubmit = vi.fn();
    render(
      <ShippingAddressForm
        onSubmit={onSubmit}
        onBack={vi.fn()}
        isSubmitting={false}
      />
    );

    fillRequiredFields();
    fireEvent.click(screen.getByRole("button", { name: /Place Order & Pay/i }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(calls.signUpCreate).not.toHaveBeenCalled();
    expect(calls.signInCreate).not.toHaveBeenCalled();
  });

  it("blocks submission when required fields are missing", async () => {
    const onSubmit = vi.fn();
    render(
      <ShippingAddressForm
        onSubmit={onSubmit}
        onBack={vi.fn()}
        isSubmitting={false}
      />
    );

    // Email-only fill — first name etc. left blank.
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "ada@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Place Order & Pay/i }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(await screen.findAllByText(/Required/i)).not.toHaveLength(0);
  });
});

describe("ShippingAddressForm — anon mode sign-up path", () => {
  it("creates a Clerk sign-up, sends an OTP, and only fires onSubmit after verify", async () => {
    const onSubmit = vi.fn();
    render(
      <ShippingAddressForm
        onSubmit={onSubmit}
        onBack={vi.fn()}
        isSubmitting={false}
        anonMode
      />
    );

    fillRequiredFields();
    fireEvent.click(screen.getByRole("button", { name: /Continue/i }));

    // The form must wait on Clerk before swapping stages — onSubmit
    // does NOT fire yet, because the OTP step gates it.
    await waitFor(() =>
      expect(calls.signUpCreate).toHaveBeenCalledWith({
        emailAddress: "ada@example.com",
      })
    );
    expect(calls.signUpPrepare).toHaveBeenCalledWith({
      strategy: "email_code",
    });
    expect(onSubmit).not.toHaveBeenCalled();

    // Stage transition to "code".
    await screen.findByText(/Verify your email/i);

    await act(async () => {
      enterOtp("424242");
    });

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(calls.signUpAttempt).toHaveBeenCalledWith({ code: "424242" });
    expect(calls.setActiveFromSignUp).toHaveBeenCalledWith({
      session: "sess-up-1",
    });
    // setUsernameFromEmail is best-effort but should run for new sign-ups.
    expect(setUsernameFromEmail).toHaveBeenCalledWith("ada@example.com");
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining(expectedAnonPayload)
    );
  });

  it("does NOT block onSubmit when setUsernameFromEmail throws", async () => {
    setUsernameFromEmail.mockRejectedValueOnce(new Error("username taken"));
    const onSubmit = vi.fn();
    render(
      <ShippingAddressForm
        onSubmit={onSubmit}
        onBack={vi.fn()}
        isSubmitting={false}
        anonMode
      />
    );

    fillRequiredFields();
    fireEvent.click(screen.getByRole("button", { name: /Continue/i }));
    await screen.findByText(/Verify your email/i);
    await act(async () => {
      enterOtp("424242");
    });

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
  });

  it("shows an error and stays on the code stage when the OTP is wrong", async () => {
    calls.signUpAttempt.mockRejectedValueOnce({
      errors: [{ longMessage: "Incorrect verification code." }],
    });
    const onSubmit = vi.fn();
    render(
      <ShippingAddressForm
        onSubmit={onSubmit}
        onBack={vi.fn()}
        isSubmitting={false}
        anonMode
      />
    );

    fillRequiredFields();
    fireEvent.click(screen.getByRole("button", { name: /Continue/i }));
    await screen.findByText(/Verify your email/i);
    await act(async () => {
      enterOtp("000000");
    });

    await screen.findByText(/Incorrect verification code/i);
    expect(onSubmit).not.toHaveBeenCalled();
    // The retry surface is still rendered.
    expect(screen.getByText(/Verify your email/i)).toBeTruthy();
  });

  it("'Use a different email' returns to the form stage with onSubmit untouched", async () => {
    const onSubmit = vi.fn();
    render(
      <ShippingAddressForm
        onSubmit={onSubmit}
        onBack={vi.fn()}
        isSubmitting={false}
        anonMode
      />
    );

    fillRequiredFields();
    fireEvent.click(screen.getByRole("button", { name: /Continue/i }));
    await screen.findByText(/Verify your email/i);

    fireEvent.click(screen.getByRole("button", { name: /Use a different email/i }));

    await screen.findByText(/Shipping Address/i);
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

describe("ShippingAddressForm — anon mode pivots to sign-in for existing accounts", () => {
  it("falls through to signIn email-code when sign-up reports form_identifier_exists", async () => {
    calls.signUpCreate.mockRejectedValueOnce({
      errors: [
        {
          code: "form_identifier_exists",
          longMessage: "That email address is taken.",
        },
      ],
    });
    const onSubmit = vi.fn();
    render(
      <ShippingAddressForm
        onSubmit={onSubmit}
        onBack={vi.fn()}
        isSubmitting={false}
        anonMode
      />
    );

    fillRequiredFields();
    fireEvent.click(screen.getByRole("button", { name: /Continue/i }));

    await waitFor(() =>
      expect(calls.signInCreate).toHaveBeenCalledWith({
        identifier: "ada@example.com",
      })
    );
    expect(calls.signInPrepare).toHaveBeenCalledWith({
      strategy: "email_code",
      emailAddressId: "eid-1",
    });

    await screen.findByText(/Looks like you already have an account/i);
    expect(calls.signUpPrepare).not.toHaveBeenCalled();

    await act(async () => {
      enterOtp("424242");
    });

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(calls.signInAttempt).toHaveBeenCalledWith({
      strategy: "email_code",
      code: "424242",
    });
    expect(calls.setActiveFromSignIn).toHaveBeenCalledWith({
      session: "sess-in-1",
    });
    // No username-from-email rewrite for returning users.
    expect(setUsernameFromEmail).not.toHaveBeenCalled();
  });

  it("surfaces a usable error when an existing account has no email-code factor", async () => {
    calls.signUpCreate.mockRejectedValueOnce({
      errors: [{ code: "form_identifier_exists" }],
    });
    calls.signInCreate.mockResolvedValueOnce({
      // No email_code factor at all — e.g. SSO-only account.
      supportedFirstFactors: [{ strategy: "oauth_google" }],
    });
    const onSubmit = vi.fn();
    render(
      <ShippingAddressForm
        onSubmit={onSubmit}
        onBack={vi.fn()}
        isSubmitting={false}
        anonMode
      />
    );

    fillRequiredFields();
    fireEvent.click(screen.getByRole("button", { name: /Continue/i }));

    await screen.findByText(/email-code sign-in isn't available/i);
    expect(onSubmit).not.toHaveBeenCalled();
    // We should still be on the form stage, not the code stage.
    expect(screen.queryByText(/Verify your email/i)).toBeNull();
  });
});
