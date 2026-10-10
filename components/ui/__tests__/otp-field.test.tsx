// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/react";
import { OtpField } from "../otp-field";

describe("OtpField", () => {
  afterEach(() => cleanup());

  it("keeps the six digits of a pasted code with separators or a prefix", () => {
    const onChange = vi.fn();
    const { container } = render(<OtpField value="" onChange={onChange} />);
    const input = container.querySelector("input")!;
    // No maxLength, or the browser would cut "Code: 123 456" before
    // onChange could strip it down to digits.
    expect(input.hasAttribute("maxlength")).toBe(false);
    fireEvent.change(input, { target: { value: "Code: 123 456" } });
    expect(onChange).toHaveBeenLastCalledWith("123456");
  });
});
