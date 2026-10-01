import type { Metadata } from "next";
import { LegalPage } from "@/components/legal/legal-page";
import { SUPPORT_MARKDOWN } from "@/lib/legal/content";

export const metadata: Metadata = {
  title: "Support",
  description: "Get help with an order, your account or a connected AI assistant.",
  alternates: { canonical: "/support" },
};

export default function SupportPage() {
  return (
    <LegalPage
      title="Support"
      markdown={SUPPORT_MARKDOWN}
      showUpdated={false}
    />
  );
}
