import type { Metadata } from "next";
import { LegalPage } from "@/components/legal/legal-page";
import { TERMS_MARKDOWN } from "@/lib/legal/content";

export const metadata: Metadata = {
  title: "Terms of Service",
  description: "The terms for using Materialize, ordering prints and selling designs.",
  alternates: { canonical: "/terms" },
};

export default function TermsPage() {
  return (
    <LegalPage
      title="Terms of Service"
      markdown={TERMS_MARKDOWN}
    />
  );
}
