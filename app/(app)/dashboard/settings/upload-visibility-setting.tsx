"use client";

import { useState, useTransition } from "react";
import { Switch } from "@/components/ui/switch";
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
    <div className="border-t border-border pt-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <div className="text-sm font-medium">
            Auto-publish print uploads to my profile
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            When on, files uploaded through the print flow or by connected
            agents are added to your public profile as free listings. Off by
            default — explicit listings published from your dashboard are
            unaffected either way.
          </p>
        </div>
        <Switch
          checked={value === "public"}
          onCheckedChange={handleChange}
          disabled={pending}
        />
      </div>
    </div>
  );
}
