"use client";

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
    <div className="space-y-3">
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <button
        type="button"
        onClick={pay}
        disabled={phase !== "idle"}
        className="w-full rounded-2xl bg-primary px-4 py-3.5 text-center text-[15px] font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {phase === "paying" && "Processing…"}
        {phase === "redirecting" && "Back to Materialize…"}
        {phase === "idle" && `Pay ${amountLabel}`}
      </button>
    </div>
  );
}
