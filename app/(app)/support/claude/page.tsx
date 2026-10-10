import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage } from "@/components/legal/legal-page";
import { SUPPORT_EMAIL } from "@/lib/legal";

export const metadata: Metadata = {
  title: "Materialize in Claude",
  description:
    "Connect Materialize to Claude to check 3D models, pick materials, price prints and order them from a conversation.",
  alternates: { canonical: "/support/claude" },
};

/**
 * Public documentation for the Claude connector. Anthropic's directory
 * requires a public docs page by the publish date, and the listing's
 * documentation URL points here. Keep it in step with the tool surface
 * in app/api/[transport]/route.ts; reviewers compare the two.
 */
const MCP_SERVER_URL = "https://www.materialize.cc/api/mcp";

export default function ClaudeConnectorPage() {
  const mail = `mailto:${SUPPORT_EMAIL}`;
  return (
    <LegalPage title="Materialize in Claude" showUpdated={false}>
      <p>
        The Materialize connector lets Claude get your 3D models professionally
        printed and shipped. Claude can check a model for problems before you
        pay, recommend materials for what the part has to do, compare prices
        from print shops, and prepare an order you approve on materialize.cc.
        It also manages the files and hardware projects in your Materialize
        library.
      </p>

      <h2>Connect</h2>
      <ul>
        <li>
          In Claude, open <strong>Customize → Connectors</strong>, find{" "}
          <strong>Materialize</strong> and click <strong>Connect</strong>.
        </li>
        <li>
          Sign in to Materialize (or create a free account) and approve the
          connection. Claude then acts as you: it sees your library and orders,
          and nothing else.
        </li>
        <li>
          To add it by URL instead, use <strong>Add custom connector</strong>{" "}
          with <code>{MCP_SERVER_URL}</code>. It works the same in Claude
          Code: <code>claude mcp add --transport http materialize {MCP_SERVER_URL}</code>.
        </li>
      </ul>

      <h2>Things to ask</h2>
      <ul>
        <li>
          &ldquo;Print this bracket I attached in something strong and heat
          resistant, and tell me what it costs shipped to the US.&rdquo;
        </li>
        <li>
          &ldquo;Will this STL print? Check it before I order.&rdquo;
        </li>
        <li>
          &ldquo;Compare nylon and resin for this part and order the cheaper
          one to my address.&rdquo;
        </li>
        <li>&ldquo;Where is my last print order?&rdquo;</li>
        <li>
          &ldquo;Turn my files into a project with a parts list and wiring
          diagram.&rdquo;
        </li>
      </ul>
      <p>
        Prices and material shortlists show as interactive cards in Claude,
        including a 3D view of your part.
      </p>

      <h2>What it can do</h2>
      <ul>
        <li>
          <strong>Read only</strong>, run without asking: list and look up
          materials, check a model&apos;s printability, recommend materials,
          get print quotes, and list your files, projects and orders.
        </li>
        <li>
          <strong>Changes your account</strong>, Claude asks first: import or
          upload a model, edit or delete your files and projects, add photos,
          parts lists and wiring diagrams, and create a print order.
        </li>
      </ul>

      <h2>Orders and payment</h2>
      <p>
        Claude never pays for anything on its own. When it creates an order,
        Materialize emails you a link, and the order is placed only after you
        review it and pay on materialize.cc with Stripe. The price Claude
        quotes includes printing, shipping, any vendor minimum and our 3%
        service fee. Print orders are US dollars only.
      </p>
      <p>
        If you choose to set up an agent spending policy in your profile
        settings, orders within its limits are charged to your saved card
        without the extra step, and you can still cancel them from the emailed
        link during the cancellation window you set. No spending policy exists until you create one.
      </p>

      <h2>Your data</h2>
      <p>
        The connector reads and changes only your own Materialize account. It
        doesn&apos;t see your conversation beyond what Claude sends to a tool.
        When you order, your model and shipping details go to CraftCloud and
        the print shop that makes it. See the{" "}
        <Link href="/privacy">Privacy Policy</Link> for details.
      </p>

      <h2>Disconnect</h2>
      <p>
        Remove Materialize in Claude&apos;s connector settings, or revoke Claude
        in your Materialize profile settings under Agents. Revoking takes
        effect immediately.
      </p>

      <h2>Troubleshooting</h2>
      <ul>
        <li>
          <strong>Sign-in loops or fails:</strong> disconnect and connect again
          from Claude&apos;s connector settings.
        </li>
        <li>
          <strong>No prices for a model:</strong> run the printability check;
          broken meshes and parts too large for every printer get no quotes.
        </li>
        <li>
          Anything else: email <a href={mail}>{SUPPORT_EMAIL}</a>.
        </li>
      </ul>
    </LegalPage>
  );
}
