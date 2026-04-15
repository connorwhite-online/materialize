import { describe, it, expect } from "vitest";
import { addressSchema, checkoutAddressSchema } from "../address";

const validAddress = {
  firstName: "Ada",
  lastName: "Lovelace",
  address: "123 Analytical St",
  city: "London",
  zipCode: "NW1 5LR",
  countryCode: "GB",
};

describe("addressSchema", () => {
  it("accepts the minimum required set of fields", () => {
    const result = addressSchema.safeParse(validAddress);
    expect(result.success).toBe(true);
  });

  it("accepts optional fields when provided", () => {
    const result = addressSchema.safeParse({
      ...validAddress,
      addressLine2: "Flat 4",
      stateCode: "ENG",
      companyName: "Analytical Engines Ltd",
      phoneNumber: "+44 20 7946 0000",
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing required fields", () => {
    for (const field of [
      "firstName",
      "lastName",
      "address",
      "city",
      "zipCode",
      "countryCode",
    ] as const) {
      const payload = { ...validAddress, [field]: "" };
      expect(addressSchema.safeParse(payload).success).toBe(false);
    }
  });

  it("rejects countryCode that isn't exactly 2 chars", () => {
    expect(
      addressSchema.safeParse({ ...validAddress, countryCode: "GBR" }).success
    ).toBe(false);
    expect(
      addressSchema.safeParse({ ...validAddress, countryCode: "G" }).success
    ).toBe(false);
  });

  it("rejects fields over their max lengths", () => {
    const longStr = "x".repeat(129);
    expect(
      addressSchema.safeParse({ ...validAddress, firstName: longStr }).success
    ).toBe(false);
    expect(
      addressSchema.safeParse({ ...validAddress, city: longStr }).success
    ).toBe(false);
  });
});

describe("checkoutAddressSchema", () => {
  it("accepts a minimal valid checkout payload", () => {
    const result = checkoutAddressSchema.safeParse({
      email: "ada@example.com",
      shipping: validAddress,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.billingSameAsShipping).toBe(true);
    }
  });

  it("accepts a split billing address", () => {
    const result = checkoutAddressSchema.safeParse({
      email: "ada@example.com",
      shipping: validAddress,
      billingSameAsShipping: false,
      billing: {
        ...validAddress,
        isCompany: true,
        vatId: "GB123456789",
      },
    });
    expect(result.success).toBe(true);
  });

  it("rejects malformed email", () => {
    const result = checkoutAddressSchema.safeParse({
      email: "not-an-email",
      shipping: validAddress,
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing shipping block", () => {
    const result = checkoutAddressSchema.safeParse({
      email: "ada@example.com",
    });
    expect(result.success).toBe(false);
  });
});
