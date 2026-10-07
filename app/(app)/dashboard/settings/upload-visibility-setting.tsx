"use client";

import { useState, useTransition } from "react";
import { Switch } from "@/components/ui/switch";
import { SettingsRow } from "@/components/ui/field";
import { updateDefaultUploadVisibility } from "@/app/actions/profile";

export function UploadVisibilitySetting({
  initial,
}: {
  initial: "public" | "private";
}) {
  const [value, setValue] = useState(initial);
  const [pending, startTransition] = useTransition();

  const handleChange = (next: boolean) => {
    const newValue = next ? "public" : "private";
    const previous = value;
    setValue(newValue);
    startTransition(async () => {
      const result = await updateDefaultUploadVisibility(newValue);
      if ("error" in result) {
        setValue(previous);
      }
    });
  };

  return (
    <SettingsRow
      htmlFor="auto-publish-uploads"
      title="Auto-publish print uploads"
      description="Files you upload to print, or that agents upload for you, appear on your profile as free listings."
      control={
        <Switch
          id="auto-publish-uploads"
          checked={value === "public"}
          onCheckedChange={handleChange}
          disabled={pending}
        />
      }
    />
  );
}
