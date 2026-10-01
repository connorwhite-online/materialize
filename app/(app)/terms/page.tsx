import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage } from "@/components/legal/legal-page";
import {
  GOVERNING_LAW,
  MINIMUM_AGE,
  OPERATOR,
  SUPPORT_EMAIL,
} from "@/lib/legal";

export const metadata: Metadata = {
  title: "Terms of Service",
  description:
    "The terms for using Materialize: accounts, print orders, selling files, content, connected apps and liability.",
  alternates: { canonical: "/terms" },
};

export default function TermsPage() {
  const mail = `mailto:${SUPPORT_EMAIL}`;
  return (
    <LegalPage title="Terms of Service">
      <p>
        These terms govern your use of Materialize (materialize.cc), including
        the website, API, MCP server and the Materialize app for AI
        assistants. Materialize is operated by {OPERATOR} (&ldquo;we&rdquo;,
        &ldquo;us&rdquo;). By using Materialize you agree to these terms and
        to our <Link href="/privacy">Privacy Policy</Link>.
      </p>

      <h2>Accounts</h2>
      <p>
        You must be at least {MINIMUM_AGE} to use Materialize. If you are
        under 18, you need a parent or guardian&apos;s permission to place
        orders or sell files. Keep your sign-in details secure; you are
        responsible for activity on your account, including actions taken
        by apps and access tokens you connect.
      </p>

      <h2>Print orders</h2>
      <ul>
        <li>
          Prints are made and shipped by independent manufacturers through
          our partner CraftCloud. We arrange the order and handle payment;
          the manufacturer produces and ships the part.
        </li>
        <li>
          Quotes come live from manufacturers and can change until you pay.
          The price shown at checkout includes production, shipping, any
          vendor minimum order value, and our 3% service fee.
        </li>
        <li>
          An order is placed only after you pay. Orders prepared by an AI
          assistant are not placed until you review and pay for them, unless
          you have set up a spending policy that allows it; those orders can
          be cancelled within the window shown in the confirmation email.
        </li>
        <li>
          You are responsible for your model being printable and fit for
          your purpose. Manufacturers may reject a model they can&apos;t
          make; if that happens you get a full refund.
        </li>
        <li>
          You can cancel for a refund until production starts. After that,
          orders can&apos;t be cancelled, but if your part arrives damaged,
          defective or not as ordered, email{" "}
          <a href={mail}>{SUPPORT_EMAIL}</a> within 30 days of delivery with
          photos and we&apos;ll work with the manufacturer on a reprint or
          refund.
        </li>
        <li>
          Delivery dates are estimates from the manufacturer and carrier.
          Customs duties and taxes for international shipments may be
          charged by your country on delivery.
        </li>
      </ul>

      <h2>Buying and selling files</h2>
      <ul>
        <li>
          Creators set their own prices and licenses. When you buy a file,
          you get the rights in its license, not ownership of the design.
        </li>
        <li>
          Sellers are paid through Stripe Connect, minus a 3% platform fee
          and Stripe&apos;s processing fees, and must complete Stripe&apos;s
          onboarding to be paid.
        </li>
        <li>
          If a purchased file is broken or not as described, open a dispute
          from your purchase and we&apos;ll review it, which may include a
          refund.
        </li>
      </ul>

      <h2>Your content</h2>
      <p>
        You keep ownership of what you upload. You give us a worldwide,
        non-exclusive, royalty-free license to host, store, process, display
        and send your content as needed to run Materialize: for example, to
        show what you publish, generate previews, and send your model to a
        manufacturer when you order a print. This license ends when you
        delete the content, except for orders already placed and copies kept
        as required by law.
      </p>
      <p>
        Only upload content you have the right to use. Don&apos;t upload or
        order anything illegal, infringing, or designed to cause harm,
        including weapons, firearm parts and items that are prohibited where
        they will be shipped. We may remove content or suspend accounts that
        break these terms. To report infringement, email{" "}
        <a href={mail}>{SUPPORT_EMAIL}</a> with the work, where it appears on
        Materialize, and your contact details.
      </p>

      <h2>Acceptable use</h2>
      <p>
        Don&apos;t misuse the service: no attempts to break security, scrape
        at scale, overload the service, get around rate limits, or use
        another person&apos;s account. Automated access must go through our
        API or MCP server, within the permissions you grant.
      </p>

      <h2>Connected apps</h2>
      <p>
        You can connect AI assistants and other apps to your account. They
        act on your behalf with the permissions you grant. You can revoke
        them at any time. We are not responsible for how a third-party app
        behaves or uses data you give it.
      </p>

      <h2>Disclaimers and liability</h2>
      <p>
        Materialize is provided &ldquo;as is&rdquo;. To the extent the law
        allows, we make no warranties about the service or about parts made
        by manufacturers, including fitness for a particular purpose.
        Don&apos;t rely on a print for safety-critical use without your own
        testing.
      </p>
      <p>
        To the extent the law allows, we aren&apos;t liable for indirect or
        consequential losses, and our total liability for any claim is
        limited to the greater of what you paid us in the 12 months before
        it arose or $100. Nothing in these terms limits rights you have
        under consumer protection law that can&apos;t be waived.
      </p>

      <h2>Ending your use</h2>
      <p>
        You can stop using Materialize and ask us to delete your account at
        any time. We may suspend or end access for violations of these terms.
        Orders already paid for will still be fulfilled or refunded.
      </p>

      <h2>Changes and law</h2>
      <p>
        We may update these terms; we&apos;ll change the date above and give
        notice of significant changes. Continuing to use Materialize after
        that means you accept them. These terms are governed by the laws of
        the State of {GOVERNING_LAW}, USA, and disputes go to the state or
        federal courts located in {GOVERNING_LAW}, unless your local law
        gives you the right to bring a claim where you live.
      </p>

      <h2>Contact</h2>
      <p>
        <a href={mail}>{SUPPORT_EMAIL}</a>
      </p>
    </LegalPage>
  );
}
