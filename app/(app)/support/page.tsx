import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage } from "@/components/legal/legal-page";
import { SUPPORT_EMAIL } from "@/lib/legal";

export const metadata: Metadata = {
  title: "Support",
  description:
    "Get help with Materialize print orders, refunds, file purchases, your account and connected AI assistants.",
  alternates: { canonical: "/support" },
};

export default function SupportPage() {
  const mail = `mailto:${SUPPORT_EMAIL}`;
  return (
    <LegalPage title="Support" showUpdated={false}>
      <p>
        Email <a href={mail}>{SUPPORT_EMAIL}</a> and we&apos;ll get back to you,
        usually within one business day. For an order, include its order
        number or the email you checked out with.
      </p>

      <h2>Print orders</h2>
      <ul>
        <li>
          Track an order from{" "}
          <Link href="/dashboard/orders">your orders</Link>. Status updates
          from the manufacturer can take a few hours to appear.
        </li>
        <li>
          You can cancel and get a refund until production starts. If a
          manufacturer rejects your model, you&apos;re refunded in full.
        </li>
        <li>
          If a part arrives damaged, defective or not as ordered, email us
          within 30 days of delivery with photos.
        </li>
      </ul>

      <h2>File purchases</h2>
      <p>
        Files you buy are in your library on the home page when you&apos;re
        signed in. If one is broken or not as described, open a dispute from
        the purchase or email us.
      </p>

      <h2>ChatGPT, Claude and other AI assistants</h2>
      <ul>
        <li>
          Connecting signs you in to your Materialize account. You approve
          each order and pay on materialize.cc unless you have set up a
          spending policy.
        </li>
        <li>
          To disconnect an assistant, revoke it in your profile settings
          under Agents, or remove it in the assistant&apos;s own settings.
        </li>
      </ul>

      <h2>Account and privacy</h2>
      <p>
        To get a copy of your data or delete your account, email us. See the{" "}
        <Link href="/privacy">Privacy Policy</Link> and{" "}
        <Link href="/terms">Terms of Service</Link>.
      </p>
    </LegalPage>
  );
}
