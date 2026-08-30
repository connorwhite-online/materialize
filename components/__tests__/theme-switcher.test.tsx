// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { ThemeSwitcher } from "@/components/theme-switcher";

const setTheme = vi.fn();

vi.mock("next-themes", () => ({
  useTheme: () => ({ theme: "light", setTheme }),
}));

describe("ThemeSwitcher", () => {
  beforeEach(() => {
    setTheme.mockClear();
  });

  it("renders icon-only theme options with accessible labels", async () => {
    render(<ThemeSwitcher />);

    // useEffect marks mounted — wait a tick so aria-checked reflects theme.
    await act(async () => {});

    expect(screen.getByRole("radio", { name: "System" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Light" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Dark" })).toBeTruthy();

    // Labels are aria/title only — no visible System/Light/Dark text buttons.
    expect(screen.queryByRole("button", { name: "System" })).toBeNull();
    expect(screen.getByRole("radio", { name: "Light" }).getAttribute("aria-checked")).toBe(
      "true"
    );
  });

  it("switches theme when an icon is pressed", async () => {
    render(<ThemeSwitcher />);
    await act(async () => {});

    fireEvent.click(screen.getByRole("radio", { name: "Dark" }));
    expect(setTheme).toHaveBeenCalledWith("dark");
  });
});
