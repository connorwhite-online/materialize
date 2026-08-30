// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import { NotificationSettingsGear } from "@/components/notifications/notification-settings-gear";

vi.mock("@/app/actions/profile", () => ({
  getMyEmailNotificationPrefs: vi.fn(async () => ({
    enabled: true,
    prefs: null,
  })),
  updateEmailNotificationsEnabled: vi.fn(async () => ({ ok: true })),
  updateEmailNotificationPref: vi.fn(async () => ({ ok: true })),
}));

vi.mock("@/components/ui/native-sheet", () => ({
  NativeSheet: ({
    open,
    children,
    ariaLabel,
  }: {
    open: boolean;
    children: React.ReactNode;
    ariaLabel: string;
  }) =>
    open ? (
      <div role="dialog" aria-label={ariaLabel}>
        {children}
      </div>
    ) : null,
}));

describe("NotificationSettingsGear", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders a chunky settings control opposite the headline affordance", () => {
    render(
      <NotificationSettingsGear initialEnabled initialPrefs={null} />
    );
    const button = screen.getByRole("button", {
      name: "Notification settings",
    });
    expect(button).toBeTruthy();
    expect(button.className).toMatch(/rounded-2xl/);
    expect(button.className).toMatch(/h-11/);
  });

  it("opens the settings sheet with email prefs", async () => {
    render(
      <NotificationSettingsGear initialEnabled initialPrefs={null} />
    );

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Notification settings" })
      );
    });

    await waitFor(() => {
      expect(
        screen.getByRole("dialog", { name: "Notification settings" })
      ).toBeTruthy();
      expect(screen.getByText("Email notifications")).toBeTruthy();
    });
  });
});
