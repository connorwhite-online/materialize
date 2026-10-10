import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage } from "@/components/legal/legal-page";
import { MINIMUM_AGE, OPERATOR, SUPPORT_EMAIL } from "@/lib/legal";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description:
    "What Materialize collects, why, who it is shared with, how long it is kept, and how to control it.",
  alternates: { canonical: "/privacy" },
};

/**
 * Required by the OpenAI plugin directory, which checks for categories
 * collected, purposes, recipients, retention and user controls. Keep
 * it true to the code: if a new processor or data type ships, it has
 * to be added here, or review rejects the plugin for returning
 * undisclosed data.
 */
export default function PrivacyPage() {
  const mail = `mailto:${SUPPORT_EMAIL}`;
  return (
    <LegalPage title="Privacy Policy">
      <p>
        Materialize (materialize.cc) is operated by {OPERATOR} (&ldquo;we&rdquo;,
        &ldquo;us&rdquo;). It lets you upload 3D models, publish and sell
        files, and order physical prints made by third-party manufacturers.
        This policy covers the website, our API and MCP server, and the
        Materialize app for ChatGPT and other AI assistants.
      </p>

      <h2>What we collect</h2>
      <ul>
        <li>
          <strong>Account details:</strong>{" "}email address, name, username,
          profile photo, and anything you add to your profile (bio, links).
          If you sign in with Google or Apple, we receive your name, email
          and profile photo from them.
        </li>
        <li>
          <strong>Content you upload:</strong>{" "}3D model files, photos,
          descriptions, comments, projects and collections, plus the
          thumbnails and geometry data we generate from your models.
        </li>
        <li>
          <strong>Order details:</strong>{" "}shipping name, address and phone
          number, the items, materials and prices you choose, and order
          status. We keep your most recent checkout phone number on your
          account.
        </li>
        <li>
          <strong>Payment details:</strong>{" "}handled by Stripe. We never see
          or store your full card number; we keep Stripe&apos;s references
          to your payments. If you sell files, Stripe collects the identity
          and bank details it needs to pay you.
        </li>
        <li>
          <strong>Connected apps:</strong>{" "}when you connect an AI assistant
          (such as ChatGPT or Claude) or create an access token, we record
          which app it is, the permissions you granted, when it was last
          used, and any spending limits you set.
        </li>
        <li>
          <strong>Technical data:</strong>{" "}error reports (which can include
          your browser, device and the page you were on), and for uploads
          made without an account, a one-way hash of your IP address to
          limit abuse. We don&apos;t use advertising trackers.
        </li>
      </ul>

      <h2>How we use it</h2>
      <ul>
        <li>To run your account and show what you publish.</li>
        <li>
          To quote, place, pay for, ship and support your print orders.
        </li>
        <li>To process sales of files and pay creators.</li>
        <li>
          To send emails about your orders, sales, comments and account
          (you can turn off the optional ones in your notification settings).
        </li>
        <li>To prevent fraud and abuse, fix bugs, and keep the service secure.</li>
        <li>To meet legal, tax and accounting obligations.</li>
      </ul>
      <p>We don&apos;t sell your personal information or use it for advertising.</p>

      <h2>Who we share it with</h2>
      <ul>
        <li>
          <strong>Manufacturing partners:</strong>{" "}when you order a print,
          your model file, chosen material, and shipping name, address and
          phone number go to CraftCloud and the print shop that makes and
          ships it.
        </li>
        <li>
          <strong>Service providers</strong>{" "}that run Materialize on our
          behalf: Clerk (sign-in), Stripe (payments and creator payouts),
          Vercel (hosting), Neon (database), Cloudflare (file storage),
          Resend (email) and Sentry (error reporting). If you use AI design
          features, your prompts and images are sent to the AI model
          provider that runs them.
        </li>
        <li>
          <strong>Other users:</strong>{" "}see &ldquo;What&apos;s public&rdquo;
          below.
        </li>
        <li>
          <strong>Apps you connect:</strong>{" "}an AI assistant you connect
          receives the data its tools return to you, such as quotes, order
          status and your files. What that app does with it is covered by
          its own privacy policy.
        </li>
        <li>
          <strong>When required:</strong>{" "}to comply with the law, respond to
          valid legal requests, or protect the rights and safety of our
          users, or as part of a transfer of the business (in which case
          this policy continues to apply).
        </li>
      </ul>

      <h2>What&apos;s public</h2>
      <p>
        Your profile (name, username, photo, bio and links) is public. Files,
        projects and collections are public only when you publish them as
        public. Drafts and anything you mark private are visible only to you
        and people you give access to, and that includes their images.
        Comments are visible to anyone who can see the item they&apos;re on.
        When you upload a photo, we remove its embedded metadata, including
        GPS location, before it is shown.
      </p>

      <h2>How long we keep it</h2>
      <ul>
        <li>
          Account and profile data: until you delete your account. We remove
          it within 30 days of your request.
        </li>
        <li>
          Uploaded files and photos: until you delete them or your account.
          Files uploaded without an account that are never ordered or saved
          are deleted automatically.
        </li>
        <li>
          Orders, payments and sales records: 7 years, for tax and
          accounting, even after you delete your account.
        </li>
        <li>Error reports: up to 90 days.</li>
        <li>
          Data held by Stripe, CraftCloud and print shops is kept under their
          own retention policies.
        </li>
      </ul>

      <h2>Your choices and rights</h2>
      <ul>
        <li>Edit your profile and content, or make items private, at any time.</li>
        <li>Turn optional email notifications off in your settings.</li>
        <li>
          Disconnect an AI assistant or revoke an access token from your
          profile settings; it stops working immediately.
        </li>
        <li>
          Ask for a copy of your data, a correction, or deletion of your
          account by emailing <a href={mail}>{SUPPORT_EMAIL}</a>. We reply
          within 30 days.
        </li>
      </ul>
      <p>
        Depending on where you live (for example California or the EU/UK),
        you may have additional rights, including to access, correct, delete
        or port your data and to object to certain uses. Email us to use
        them; we won&apos;t treat you differently for doing so. Our service
        is run from the United States, so your data is processed there.
      </p>

      <h2>Cookies</h2>
      <p>
        We use only the cookies and browser storage needed to keep you
        signed in, secure your session, and remember preferences such as
        light or dark mode.
      </p>

      <h2>Children</h2>
      <p>
        Materialize is not for children under {MINIMUM_AGE}, and we don&apos;t
        knowingly collect their data. If you believe a child under{" "}
        {MINIMUM_AGE} has an account, email us and we&apos;ll delete it.
      </p>

      <h2>Security</h2>
      <p>
        Data is encrypted in transit, payments are handled by Stripe, and
        access to production systems is restricted. No system is perfectly
        secure; if a breach affects you, we&apos;ll tell you as the law
        requires.
      </p>

      <h2>Changes</h2>
      <p>
        If we change this policy, we&apos;ll update the date at the top, and
        for significant changes we&apos;ll notify you by email or on the site.
      </p>

      <h2>Contact</h2>
      <p>
        Questions or requests: <a href={mail}>{SUPPORT_EMAIL}</a>. See also
        our <Link href="/terms">Terms of Service</Link>.
      </p>
    </LegalPage>
  );
}
