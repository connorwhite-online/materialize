"use client";

import { Button } from "@/components/ui/button";
import { useState } from "react";
import { paySandboxProductionOrder } from "@/app/actions/sandbox-checkout";

/**
 * The sandbox checkout's Pay button: runs the mock production payment
 * (capture fee + advance to `ordered`) and forwards to the orders tab
 * with the production=paid flag so the profile renders its
 * order-placed banner.
 */
export function SandboxPayButton({
  orderId,
  amountLabel,
}: {
  orderId: string;
  amountLabel: string;
}) {
  const [phase, setPhase] = useState<"idle" | "paying" | "redirecting">(
    "idle"
  );
  const [error, setError] = useState<string | null>(null);

  const pay = async () => {
    if (phase !== "idle") return;
    setError(null);
    setPhase("paying");
    const result = await paySandboxProductionOrder(orderId);
    if ("error" in result) {
      setError(result.error);
      setPhase("idle");
      return;
    }
    setPhase("redirecting");
    window.location.href = result.redirectUrl;
  };

  return (
    <div className="flex flex-col gap-2">
      {error && (
        <p role="alert" className="text-[13px] leading-[18px] text-destructive">
          {error}
        </p>
      )}
      {/* Stand-in for a hosted payment page: a single full-width pay
          button is the convention there (and this column is ~22rem). */}
      <Button
        type="button"
        size="lg"
        className="w-full"
        onClick={pay}
        loading={phase !== "idle"}
      >
        {phase === "paying" && "Processing…"}
        {phase === "redirecting" && "Back to Materialize…"}
        {phase === "idle" && `Pay ${amountLabel}`}
      </Button>
    </div>
  );
}
