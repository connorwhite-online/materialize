import {
  Body,
  Container,
  Head,
  Hr,
  Html,
  Link,
  Preview,
  Section,
  Text,
} from "@react-email/components";

export interface AgentOrderCancellationConfirmedEmailProps {
  agentName: string;
  fileName: string;
  totalDisplay: string;
  ordersUrl: string;
  revokeAgentUrl: string;
}

/**
 * Sent after the user clicks "Cancel" on an auto-approved order
 * within the cancellation window. Confirms the refund is on its
 * way and the order will not be placed with the print vendor.
 */
export function AgentOrderCancellationConfirmedEmail({
  agentName,
  fileName,
  totalDisplay,
  ordersUrl,
  revokeAgentUrl,
}: AgentOrderCancellationConfirmedEmailProps) {
  const preview = `Order from ${agentName} cancelled — refund of ${totalDisplay} on the way`;
  return (
    <Html>
      <Head />
      <Preview>{preview}</Preview>
      <Body style={body}>
        <Container style={container}>
          <Section style={brandSection}>
            <Text style={brand}>Materialize</Text>
          </Section>

          <Section>
            <Text style={heading}>Order cancelled</Text>
            <Text style={paragraph}>
              We&apos;ve cancelled the order from{" "}
              <strong>{agentName}</strong> for{" "}
              <strong>{fileName}</strong>. A refund of{" "}
              <strong>{totalDisplay}</strong> is on its way to your saved
              card — most banks reflect the refund within 5–10 business days.
            </Text>
            <Text style={paragraph}>
              The order will not be sent to the print vendor.
            </Text>
          </Section>

          <Section>
            <Text style={small}>
              <Link style={link} href={ordersUrl}>
                View your orders →
              </Link>
            </Text>
          </Section>

          <Hr style={hr} />

          <Section>
            <Text style={smallMuted}>
              Want to prevent this in the future?{" "}
              <Link style={link} href={revokeAgentUrl}>
                Revoke the agent&apos;s access
              </Link>{" "}
              or tighten its spending policy in your settings.
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

const body: React.CSSProperties = {
  backgroundColor: "#f6f6f6",
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif',
  margin: 0,
  padding: "24px 0",
};
const container: React.CSSProperties = {
  backgroundColor: "#ffffff",
  border: "1px solid #e5e5e5",
  borderRadius: 12,
  margin: "0 auto",
  maxWidth: 480,
  padding: "32px 28px",
};
const brandSection: React.CSSProperties = { marginBottom: 16 };
const brand: React.CSSProperties = {
  color: "#111",
  fontSize: 14,
  fontWeight: 600,
  letterSpacing: 0.2,
  margin: 0,
};
const heading: React.CSSProperties = {
  color: "#111",
  fontSize: 22,
  fontWeight: 700,
  lineHeight: "1.3",
  margin: "8px 0 12px",
};
const paragraph: React.CSSProperties = {
  color: "#444",
  fontSize: 14,
  lineHeight: "1.5",
  margin: "0 0 8px",
};
const link: React.CSSProperties = { color: "#111", textDecoration: "underline" };
const small: React.CSSProperties = {
  color: "#444",
  fontSize: 13,
  lineHeight: "1.5",
  margin: "16px 0 0",
};
const smallMuted: React.CSSProperties = {
  color: "#888",
  fontSize: 12,
  lineHeight: "1.5",
  margin: "0",
};
const hr: React.CSSProperties = { borderColor: "#eee", margin: "24px 0" };

export function renderAgentOrderCancellationConfirmedText(
  props: AgentOrderCancellationConfirmedEmailProps
): string {
  return [
    `Your order from ${props.agentName} for ${props.fileName} has been`,
    `cancelled. A refund of ${props.totalDisplay} is on its way to your`,
    `saved card (most banks reflect refunds within 5–10 business days).`,
    ``,
    `The order will not be sent to the print vendor.`,
    ``,
    `View your orders:`,
    `  ${props.ordersUrl}`,
    ``,
    `Want to prevent this in the future? Revoke the agent's access:`,
    `  ${props.revokeAgentUrl}`,
  ].join("\n");
}
