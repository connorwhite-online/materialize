import type { Metadata } from "next";
import { LegalPage } from "@/components/legal/legal-page";
import { PRIVACY_MARKDOWN } from "@/lib/legal/content";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "How Materialize collects, uses and shares your information.",
  alternates: { canonical: "/privacy" },
};

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy Policy"
      markdown={PRIVACY_MARKDOWN}
    />
  );
}
