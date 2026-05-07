import {
  Body,
  Button,
  Container,
  Head,
  Hr,
  Html,
  Link,
  Preview,
  Section,
  Text,
} from "@react-email/components";

export interface AgentOrderAutoApprovedEmailProps {
  agentName: string;
  fileName: string;
  materialName: string;
  vendorName: string;
  totalDisplay: string;
  cancelUrl: string;
  cancelDeadlineDisplay: string;
  remainingBudgetDisplay: string | null;
  revokeAgentUrl: string;
}

/**
 * Receipt-style email sent immediately after an agent-initiated
 * order is auto-charged. Different intent than the confirm-by-
 * email template: the action has already happened — this is a
 * notification with a short cancel window. Emphasize what changed
 * (charge made, fulfillment in N min) and surface the cancel link
 * prominently. After the window the order proceeds and a separate
 * "your order is on its way" email could fire (out of scope here).
 */
export function AgentOrderAutoApprovedEmail({
  agentName,
  fileName,
  materialName,
  vendorName,
  totalDisplay,
  cancelUrl,
  cancelDeadlineDisplay,
  remainingBudgetDisplay,
  revokeAgentUrl,
}: AgentOrderAutoApprovedEmailProps) {
  const preview = `${agentName} just placed an order — cancel ${cancelDeadlineDisplay} (${totalDisplay})`;
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
            <Text style={heading}>Your agent placed an order</Text>
            <Text style={paragraph}>
              <strong>{agentName}</strong> placed the following print order on
              your behalf and your saved card was charged{" "}
              <strong>{totalDisplay}</strong>. The order goes to the print
              vendor automatically{" "}
              <strong>{cancelDeadlineDisplay}</strong> — you can cancel and
              get a full refund before then.
            </Text>
          </Section>

          <Section style={summary}>
            <Row label="File" value={fileName} />
            <Row label="Material" value={materialName} />
            <Row label="Vendor" value={vendorName} />
            <Row label="Charged" value={totalDisplay} bold />
            {remainingBudgetDisplay && (
              <Row label="Remaining budget" value={remainingBudgetDisplay} />
            )}
          </Section>

          <Section style={cta}>
            <Button style={button} href={cancelUrl}>
              Cancel and refund
            </Button>
            <Text style={small}>
              Or open this link:{" "}
              <Link style={link} href={cancelUrl}>
                {cancelUrl}
              </Link>
            </Text>
            <Text style={small}>
              The cancel window closes {cancelDeadlineDisplay}.
            </Text>
          </Section>

          <Hr style={hr} />

          <Section>
            <Text style={smallMuted}>
              Didn&apos;t expect this? You can{" "}
              <Link style={link} href={revokeAgentUrl}>
                revoke the agent&apos;s access
              </Link>{" "}
              and review its spending policy in your settings.
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

function Row({
  label,
  value,
  bold,
}: {
  label: string;
  value: string;
  bold?: boolean;
}) {
  return (
    <Text style={row}>
      <span style={rowLabel}>{label}</span>
      <span style={bold ? rowValueBold : rowValue}>{value}</span>
    </Text>
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
const summary: React.CSSProperties = {
  backgroundColor: "#fafafa",
  border: "1px solid #eee",
  borderRadius: 10,
  padding: "12px 14px",
  margin: "20px 0",
};
const row: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  margin: "4px 0",
  fontSize: 13,
  lineHeight: "1.5",
};
const rowLabel: React.CSSProperties = { color: "#777" };
const rowValue: React.CSSProperties = { color: "#222" };
const rowValueBold: React.CSSProperties = { color: "#111", fontWeight: 600 };
const cta: React.CSSProperties = { margin: "8px 0" };
const button: React.CSSProperties = {
  backgroundColor: "#111",
  borderRadius: 999,
  color: "#fff",
  display: "inline-block",
  fontSize: 14,
  fontWeight: 600,
  padding: "10px 20px",
  textDecoration: "none",
};
const link: React.CSSProperties = { color: "#111", textDecoration: "underline" };
const small: React.CSSProperties = {
  color: "#666",
  fontSize: 12,
  lineHeight: "1.5",
  margin: "12px 0 0",
  wordBreak: "break-all",
};
const smallMuted: React.CSSProperties = {
  color: "#888",
  fontSize: 12,
  lineHeight: "1.5",
  margin: "0",
};
const hr: React.CSSProperties = { borderColor: "#eee", margin: "24px 0" };

export function renderAgentOrderAutoApprovedText(
  props: AgentOrderAutoApprovedEmailProps
): string {
  return [
    `${props.agentName} placed a print order on your Materialize account and`,
    `your saved card was charged ${props.totalDisplay}.`,
    ``,
    `  File:     ${props.fileName}`,
    `  Material: ${props.materialName}`,
    `  Vendor:   ${props.vendorName}`,
    `  Charged:  ${props.totalDisplay}`,
    ...(props.remainingBudgetDisplay
      ? [`  Budget:   ${props.remainingBudgetDisplay} remaining`]
      : []),
    ``,
    `The order goes to the print vendor ${props.cancelDeadlineDisplay}.`,
    `Cancel and refund:`,
    `  ${props.cancelUrl}`,
    ``,
    `Didn't expect this? Revoke the agent's access:`,
    `  ${props.revokeAgentUrl}`,
  ].join("\n");
}
