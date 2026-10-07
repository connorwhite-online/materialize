// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

// The code step mounts input-otp, which needs browser APIs jsdom lacks.
// Same stubs as shipping-address-form.test.tsx.
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

// The password path exists for accounts given a password in the Clerk
// dashboard — chiefly the OpenAI plugin reviewer, who can't receive an
// email code. Email codes stay the default; these tests pin both.

const signIn = {
  status: "needs_first_factor" as string,
  create: vi.fn(),
  password: vi.fn(),
  finalize: vi.fn(),
  reset: vi.fn(),
  emailCode: { sendCode: vi.fn(), verifyCode: vi.fn() },
};

vi.mock("@clerk/nextjs", () => ({
  useSignIn: () => ({ signIn }),
  useSignUp: () => ({ signUp: {} }),
}));
vi.mock("@/app/actions/onboarding", () => ({ setUsername: vi.fn() }));
vi.mock("../social-buttons", () => ({ SocialButtons: () => null }));

import { SignInForm } from "../sign-in-form";

beforeEach(() => {
  signIn.status = "needs_first_factor";
  signIn.create.mockResolvedValue({ error: null });
  signIn.emailCode.sendCode.mockResolvedValue({ error: null });
  signIn.password.mockImplementation(async () => {
    signIn.status = "complete";
    return { error: null };
  });
  signIn.finalize.mockResolvedValue({ error: null });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("SignInForm", () => {
  it("sends an email code by default and shows no password field", async () => {
    render(<SignInForm />);
    expect(screen.queryByLabelText("Password")).toBeNull();

    fireEvent.change(screen.getByLabelText("Email or username"), {
      target: { value: "a@b.co" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(() => expect(signIn.emailCode.sendCode).toHaveBeenCalled());
    expect(signIn.password).not.toHaveBeenCalled();
  });

  it("signs in with a password when the user opts into it", async () => {
    render(<SignInForm />);
    fireEvent.click(screen.getByRole("button", { name: "Use a password" }));

    fireEvent.change(screen.getByLabelText("Email or username"), {
      target: { value: "reviewer@materialize.cc" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "hunter22" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => expect(signIn.finalize).toHaveBeenCalled());
    expect(signIn.password).toHaveBeenCalledWith({
      identifier: "reviewer@materialize.cc",
      password: "hunter22",
    });
    expect(signIn.emailCode.sendCode).not.toHaveBeenCalled();
  });

  it("shows Clerk's error and stays put on a wrong password", async () => {
    signIn.password.mockResolvedValue({
      error: { longMessage: "Password is incorrect. Try again." },
    });
    render(<SignInForm />);
    fireEvent.click(screen.getByRole("button", { name: "Use a password" }));
    fireEvent.change(screen.getByLabelText("Email or username"), {
      target: { value: "reviewer@materialize.cc" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "wrong" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    expect(
      await screen.findByText("Password is incorrect. Try again.")
    ).toBeTruthy();
    expect(signIn.finalize).not.toHaveBeenCalled();
  });

  it("moves to a code step that names the address and can resend", async () => {
    render(<SignInForm />);
    fireEvent.change(screen.getByLabelText("Email or username"), {
      target: { value: "a@b.co" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    expect(await screen.findByText("Check your email")).toBeTruthy();
    expect(screen.getByText("a@b.co")).toBeTruthy();
    expect(signIn.emailCode.sendCode).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Resend code" }));
    await waitFor(() =>
      expect(signIn.emailCode.sendCode).toHaveBeenCalledTimes(2)
    );
    expect(await screen.findByText("New code sent.")).toBeTruthy();
  });
});
