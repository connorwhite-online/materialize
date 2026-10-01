/**
 * Copy for /privacy, /terms and /support. Kept as markdown here so the
 * pages stay thin and the text can be reviewed (and lawyered) as text.
 *
 * The operator is named as Connor White (sole proprietor) until the
 * LLC exists. When it does, update the operator name in this copy and
 * the OpenAI plugin's developer name (plugins/materialize/plugin.json)
 * together: the listing's publisher must match OpenAI's verification.
 */

export const LEGAL_LAST_UPDATED = "October 1, 2026";

export const SUPPORT_EMAIL = "support@materialize.cc";

export const PRIVACY_MARKDOWN = `Materialize ("we", "us") runs materialize.cc, a marketplace for 3D models and a service that gets them professionally printed and shipped. This policy explains what we collect, who we share it with, and the choices you have.

## What we collect

- **Account details.** Your email, name, username and profile photo, through our sign-in provider, Clerk. You can also add a bio and social links.
- **Models and content you upload.** 3D model files, photos, wiring diagrams, project write-ups, comments, and listings you publish.
- **Order details.** For print orders: shipping and billing name, address, email and phone number. We save the most recent checkout phone number to your account so you don't have to re-enter it.
- **Payment details.** Card and bank details go directly to Stripe. We never see or store your full card number. We keep Stripe's customer and account identifiers, and a reference to your saved payment method.
- **CAD studio content.** If you use the text-to-CAD studio, we keep your prompts, reference images, the generated designs, and the AI conversation transcript for each design.
- **Connected apps.** If you connect an AI assistant (for example ChatGPT, Claude or Codex) or create an access token, we record which app or token acted and when, and the orders it created.
- **Technical data.** Error reports (tagged with your account ID, with emails, phone numbers and passwords removed), and a salted hash of your IP address when you upload without an account, used only for rate limiting.

We don't use advertising trackers or third-party analytics, and we don't sell your personal information.

## Who we share it with

We share only what each service needs to do its job:

| Service | What it receives | Why |
|---|---|---|
| Clerk | Account details | Sign-in and accounts |
| Stripe | Email, name, payment details | Payments, saved cards, seller payouts |
| CraftCloud and the print shops it works with | Your model file, filename, email, shipping and billing address, phone | Making and shipping your print. CraftCloud stores files in the EU. |
| Cloudflare (R2) | Files you upload | Storage |
| Neon | Account, order and content records | Database hosting |
| Resend | Your email address and the message | Sending emails |
| Sentry | Error reports, without contact details | Fixing bugs |
| Vercel | Requests to our site | Hosting |
| Anthropic, OpenAI, fal.ai | Your CAD prompts and reference images | Generating designs, only if you use the CAD studio |

You choose what's public. Files, projects and collections you publish as public, your profile, and comments on public items are visible to everyone. Drafts and anything you mark private are visible only to you and the people you give access to, such as your organization. We remove location data from photos when you upload them.

When you connect an AI assistant, that assistant sees whatever our tools return to it, such as quotes, your files and your order status. Its own privacy policy covers what it does with that.

## How long we keep it

- Uploads that never become a file are deleted after about a day. Unsaved CAD studio drafts are deleted after 30 days.
- Order records, including shipping addresses, are kept for as long as your account exists, for tax, refund and dispute purposes.
- When your account is deleted, your profile and the content linked to it are deleted from our database, and stored files are removed afterward.

## Your choices and rights

- Edit your profile, notification settings and connected apps at any time in your account settings. You can revoke a connected app or token there.
- To delete your account or get a copy of your data, email [support@materialize.cc](mailto:support@materialize.cc). We'll respond within 30 days.
- Depending on where you live, you may have extra rights, such as correction, objection or complaint to a regulator. Contact us and we'll help.

## Cookies

We use only the cookies needed to keep you signed in (set by Clerk) and to process payments safely (set by Stripe). We remember your light or dark theme in your browser's local storage.

## Children

Materialize isn't intended for children under 13, and we don't knowingly collect their information.

## Changes and contact

If we change this policy in a meaningful way, we'll update the date above and tell signed-in users. Questions: [support@materialize.cc](mailto:support@materialize.cc). Connor White, doing business as Materialize, California, USA.
`;

export const TERMS_MARKDOWN = `These terms are an agreement between you and Connor White, doing business as Materialize ("Materialize", "we"), covering materialize.cc, our MCP server, and the Materialize apps for AI assistants. By using them you agree to these terms.

## 1. What Materialize does

- **Print ordering.** You give us a 3D model and we get prices from independent print shops through our fulfillment partner, CraftCloud. When you order, the shop you pick makes and ships the part. Materialize arranges the order. We don't manufacture parts ourselves.
- **Marketplace.** Creators publish models and hardware projects. Some are free and some are sold. Sales are between the buyer and the creator, and we process the payment.
- **CAD studio.** Where available, AI tools help you design printable parts.

## 2. Accounts

You need an account to order, sell or publish. Keep your sign-in secure. You're responsible for what happens under your account, including actions by AI assistants or access tokens you connect. You must be at least 13 to use Materialize.

## 3. Print orders

- Prices come from the print shops and include production and shipping, plus Materialize's service fee, shown before you pay. Some shops have a minimum order value, and we show it in the price.
- An order is placed with the shop only after payment succeeds. Once production starts it generally can't be cancelled.
- You're responsible for the model you submit: its dimensions, units, printability, and whether it's fit for your purpose. Printed parts can vary within normal manufacturing tolerances. Don't use them where failure could cause injury unless you've validated them yourself.
- If a part arrives damaged, wrong, or doesn't arrive, contact us at [support@materialize.cc](mailto:support@materialize.cc) within 30 days. We'll work with the shop on a reprint or refund.
- Don't order anything illegal, including weapons or weapon parts where prohibited, or items that infringe someone else's rights. Shops may refuse any order.

## 4. Orders placed through AI assistants

You can connect an AI assistant (for example ChatGPT, Claude or Codex) or create an access token. By default, every order it prepares waits for you to review and pay on materialize.cc. If you set a spending policy that lets a connection order on its own, you authorize charges to your saved payment method within the limits you set. Each such order emails you a receipt with a cancel link that works during the cancellation window. You can change limits or revoke a connection at any time.

## 5. Selling and publishing

- You keep ownership of what you upload. You give Materialize a worldwide, non-exclusive license to host, display, reproduce and distribute it as needed to run the service. That includes sending files to print shops for orders and making thumbnails and previews.
- You choose the license your listing is offered under. Buyers get the rights that license grants.
- Only upload content you have the rights to. We may remove content and suspend accounts for infringement or abuse. To report infringement, email [support@materialize.cc](mailto:support@materialize.cc) with the URL and the basis of your claim.
- Sellers are paid through Stripe Connect and must complete Stripe's onboarding. Materialize keeps a service fee on each sale, shown when you set a price. Refunds on a sale may be reversed from your payout.

## 6. Acceptable use

Don't break the law, infringe others' rights, upload malware, scrape the site at a load that disrupts it, get around access controls or rate limits, or use the service to harass anyone.

## 7. Disclaimers and liability

Materialize is provided "as is." To the extent the law allows, we disclaim implied warranties, and our total liability for any claim is limited to the greater of what you paid us in the 12 months before the claim or $100. We aren't liable for indirect or consequential damages. Nothing here limits rights you have that can't be waived by law.

## 8. Changes and ending

We may update these terms. If a change is meaningful, we'll notify signed-in users before it takes effect. You can stop using Materialize at any time. We may suspend accounts that break these terms.

## 9. Law and contact

These terms are governed by the laws of the State of California. Questions: [support@materialize.cc](mailto:support@materialize.cc).
`;

export const SUPPORT_MARKDOWN = `## Get help

Email [support@materialize.cc](mailto:support@materialize.cc). For an order, include its order number, which is in your confirmation email and on your Orders page.

## Common questions

**Where's my print?** Open Orders from your profile. Status updates come from the print shop about once an hour. Production times depend on the material and shop, and are shown when you order.

**Something's wrong with my part.** Email us within 30 days of delivery with photos, and we'll arrange a reprint or refund with the shop.

**Can I cancel an order?** Before you pay, just leave it; unpaid orders expire after 48 hours. After payment, email us right away. Once production starts, it usually can't be stopped.

**I connected ChatGPT, Claude or another assistant. How do I disconnect it?** Go to the Agents tab on your profile and select Revoke. You can also set or change spending limits there.

**Delete my account or get my data.** Email [support@materialize.cc](mailto:support@materialize.cc) from the address on your account.

**Report a listing.** Email [support@materialize.cc](mailto:support@materialize.cc) with the link and what's wrong.
`;
