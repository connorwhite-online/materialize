"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

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

export function ShippingAddressForm({
  onSubmit,
  onBack,
  isSubmitting,
}: ShippingAddressFormProps) {
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

  const validate = () => {
    const errs: Record<string, string> = {};
    if (!email || !email.includes("@")) errs.email = "Valid email required";
    if (!shipping.firstName) errs.firstName = "Required";
    if (!shipping.lastName) errs.lastName = "Required";
    if (!shipping.address) errs.address = "Required";
    if (!shipping.city) errs.city = "Required";
    if (!shipping.zipCode) errs.zipCode = "Required";
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

    const billingAddress = billingSame ? shipping : billing;
    onSubmit({
      email,
      shipping,
      billing: { ...billingAddress, isCompany: false },
    });
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

  return (
    <form onSubmit={handleSubmit}>
      <Card>
        <CardHeader>
          <CardTitle>Shipping Address</CardTitle>
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
            />
            {errors.email && (
              <p className="mt-1 text-xs text-destructive">{errors.email}</p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="firstName">First Name</Label>
              <Input
                id="firstName"
                value={shipping.firstName}
                onChange={(e) => updateShipping("firstName", e.target.value)}
              />
              {errors.firstName && (
                <p className="mt-1 text-xs text-destructive">{errors.firstName}</p>
              )}
            </div>
            <div>
              <Label htmlFor="lastName">Last Name</Label>
              <Input
                id="lastName"
                value={shipping.lastName}
                onChange={(e) => updateShipping("lastName", e.target.value)}
              />
              {errors.lastName && (
                <p className="mt-1 text-xs text-destructive">{errors.lastName}</p>
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
            />
            {errors.address && (
              <p className="mt-1 text-xs text-destructive">{errors.address}</p>
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
              />
              {errors.city && (
                <p className="mt-1 text-xs text-destructive">{errors.city}</p>
              )}
            </div>
            <div>
              <Label htmlFor="zipCode">Postal Code</Label>
              <Input
                id="zipCode"
                value={shipping.zipCode}
                onChange={(e) => updateShipping("zipCode", e.target.value)}
              />
              {errors.zipCode && (
                <p className="mt-1 text-xs text-destructive">{errors.zipCode}</p>
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

          <div className="flex items-center gap-2 pt-2">
            <Checkbox
              id="billingSame"
              checked={billingSame}
              onCheckedChange={(checked) => setBillingSame(checked === true)}
            />
            <Label htmlFor="billingSame" className="text-sm font-normal">
              Billing address same as shipping
            </Label>
          </div>
        </CardContent>
      </Card>

      <div className="mt-6 flex gap-3">
        <Button type="button" variant="outline" onClick={onBack} disabled={isSubmitting}>
          Back
        </Button>
        <Button type="submit" disabled={isSubmitting} className="flex-1">
          {isSubmitting ? "Processing..." : "Place Order & Pay"}
        </Button>
      </div>
    </form>
  );
}
