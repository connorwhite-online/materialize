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

export interface AgentOrderConfirmationEmailProps {
  agentName: string;
  fileName: string;
  materialName: string;
  vendorName: string;
  totalDisplay: string;
  confirmationUrl: string;
  revokeAgentUrl: string;
  expiresAtDisplay: string;
}

export function AgentOrderConfirmationEmail({
  agentName,
  fileName,
  materialName,
  vendorName,
  totalDisplay,
  confirmationUrl,
  revokeAgentUrl,
  expiresAtDisplay,
}: AgentOrderConfirmationEmailProps) {
  const preview = `${agentName} prepared a print order — review and pay (${totalDisplay})`;
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
            <Text style={heading}>Confirm a print order</Text>
            <Text style={paragraph}>
              <strong>{agentName}</strong> — an agent connected to your
              Materialize account — prepared the following order on your
              behalf. Nothing has been charged yet. Review the details and
              confirm to pay.
            </Text>
          </Section>

          <Section style={summary}>
            <Row label="File" value={fileName} />
            <Row label="Material" value={materialName} />
            <Row label="Vendor" value={vendorName} />
            <Row label="Total" value={totalDisplay} bold />
          </Section>

          <Section style={cta}>
            <Button style={button} href={confirmationUrl}>
              Review and pay
            </Button>
            <Text style={small}>
              Or open this link:{" "}
              <Link style={link} href={confirmationUrl}>
                {confirmationUrl}
              </Link>
            </Text>
            <Text style={small}>This link expires {expiresAtDisplay}.</Text>
          </Section>

          <Hr style={hr} />

          <Section>
            <Text style={smallMuted}>
              Didn&apos;t expect this? You can{" "}
              <Link style={link} href={revokeAgentUrl}>
                revoke the agent&apos;s access
              </Link>{" "}
              from your account settings — the agent will lose its connection
              immediately.
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

const brandSection: React.CSSProperties = {
  marginBottom: 16,
};

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

const rowLabel: React.CSSProperties = {
  color: "#777",
};

const rowValue: React.CSSProperties = {
  color: "#222",
};

const rowValueBold: React.CSSProperties = {
  color: "#111",
  fontWeight: 600,
};

const cta: React.CSSProperties = {
  margin: "8px 0",
};

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

const link: React.CSSProperties = {
  color: "#111",
  textDecoration: "underline",
};

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

const hr: React.CSSProperties = {
  borderColor: "#eee",
  margin: "24px 0",
};

export function renderAgentOrderConfirmationText(
  props: AgentOrderConfirmationEmailProps
): string {
  return [
    `${props.agentName} prepared a print order on your Materialize account.`,
    ``,
    `  File:     ${props.fileName}`,
    `  Material: ${props.materialName}`,
    `  Vendor:   ${props.vendorName}`,
    `  Total:    ${props.totalDisplay}`,
    ``,
    `Review and pay:`,
    `  ${props.confirmationUrl}`,
    ``,
    `This link expires ${props.expiresAtDisplay}.`,
    ``,
    `Didn't expect this? Revoke the agent's access:`,
    `  ${props.revokeAgentUrl}`,
  ].join("\n");
}
