// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";

vi.mock("@/app/actions/cad-generation", () => ({
  getCadStepDownloadUrl: vi.fn(),
}));

import { StepDownloadLink } from "@/components/files/step-download-button";
import { getCadStepDownloadUrl } from "@/app/actions/cad-generation";

const mockProbe = vi.mocked(getCadStepDownloadUrl);

describe("StepDownloadLink", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders an enabled link once the probe resolves a URL (known-present)", async () => {
    mockProbe.mockResolvedValue({ url: "https://r2.example/model.step" });
    render(<StepDownloadLink fileAssetId="fa-1" available />);

    // Slot is held with a disabled stand-in while the URL resolves.
    expect(screen.getByText("Download STEP (editable CAD)")).toBeTruthy();

    const link = await screen.findByRole("link");
    expect(link.getAttribute("href")).toBe("https://r2.example/model.step");
  });

  it("shows 'STEP unavailable' when the probe returns an error (known-present)", async () => {
    mockProbe.mockResolvedValue({ error: "Not found" });
    render(<StepDownloadLink fileAssetId="fa-1" available />);

    expect(await screen.findByText("STEP unavailable")).toBeTruthy();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("shows 'STEP unavailable' when the probe returns url: null (known-present)", async () => {
    mockProbe.mockResolvedValue({ url: null });
    render(<StepDownloadLink fileAssetId="fa-1" available />);

    expect(await screen.findByText("STEP unavailable")).toBeTruthy();
  });

  it("shows 'STEP unavailable' when the probe rejects (known-present)", async () => {
    mockProbe.mockRejectedValue(new Error("network"));
    render(<StepDownloadLink fileAssetId="fa-1" available />);

    expect(await screen.findByText("STEP unavailable")).toBeTruthy();
  });

  it("renders nothing when told there is no STEP, without probing", () => {
    const { container } = render(
      <StepDownloadLink fileAssetId="fa-1" available={false} />
    );
    expect(container.innerHTML).toBe("");
    expect(mockProbe).not.toHaveBeenCalled();
  });

  it("legacy self-probe path stays hidden on failure instead of surfacing an error", async () => {
    mockProbe.mockResolvedValue({ error: "Not found" });
    const { container } = render(<StepDownloadLink fileAssetId="fa-1" />);

    await waitFor(() => expect(mockProbe).toHaveBeenCalled());
    expect(container.innerHTML).toBe("");
  });

  it("legacy self-probe path appears once a URL resolves", async () => {
    mockProbe.mockResolvedValue({ url: "https://r2.example/model.step" });
    render(<StepDownloadLink fileAssetId="fa-1" />);

    const link = await screen.findByRole("link");
    expect(link.getAttribute("href")).toBe("https://r2.example/model.step");
  });
});
