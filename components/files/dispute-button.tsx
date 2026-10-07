"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { fileListingDispute } from "@/app/actions/disputes";

/**
 * Owner-facing CTA on the flagged-listing banner. Collects a short reason
 * and files a dispute (CON-67). Inline, no modal — keeps the banner self-
 * contained.
 */
export function DisputeButton({ fileId }: { fileId: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (done) {
    return (
      <p
        role="status"
        className="mt-3 text-[13px] leading-[18px] text-muted-foreground"
      >
        Dispute submitted — we&apos;ll review it and follow up by email.
      </p>
    );
  }

  if (!open) {
    return (
      <Button
        variant="outline"
        size="sm"
        className="mt-3"
        onClick={() => setOpen(true)}
      >
        Dispute this flag
      </Button>
    );
  }

  const submit = () => {
    setError(null);
    startTransition(async () => {
      const res = await fileListingDispute({ fileId, reason });
      if ("error" in res) setError(res.error);
      else setDone(true);
    });
  };

  return (
    <div className="mt-3 flex flex-col gap-2">
      <Textarea
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        rows={3}
        maxLength={2000}
        placeholder="Briefly explain why this is your original work."
        aria-label="Dispute reason"
        autoFocus
      />
      {error && (
        <p role="alert" className="text-[13px] leading-[18px] text-destructive">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button
          variant="secondary"
          size="sm"
          disabled={pending}
          onClick={() => setOpen(false)}
        >
          Cancel
        </Button>
        <Button
          size="sm"
          loading={pending}
          disabled={reason.trim().length === 0}
          onClick={submit}
        >
          Submit dispute
        </Button>
      </div>
    </div>
  );
}
