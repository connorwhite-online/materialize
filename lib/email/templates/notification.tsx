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

export interface NotificationEmailProps {
  /** Plain-language sentence describing the event, e.g. "Connor commented on your file Caribiner". */
  headline: string;
  /** Optional snippet of the comment body / make caption. */
  snippet?: string | null;
  /** Absolute URL the CTA + raw link point at — should deep-link to the source. */
  href: string;
  /** Absolute URL of the recipient's notification settings (for the unsubscribe footer). */
  settingsUrl: string;
}

/**
 * Single notification email — used for comment, reply, and make
 * events. The header sentence carries the variation; the body shape
 * stays uniform so we don't ship three near-identical templates.
 */
export function NotificationEmail({
  headline,
  snippet,
  href,
  settingsUrl,
}: NotificationEmailProps) {
  return (
    <Html>
      <Head />
      <Preview>{headline}</Preview>
      <Body style={body}>
        <Container style={container}>
          <Section style={brandSection}>
            <Text style={brand}>Materialize</Text>
          </Section>

          <Section>
            <Text style={heading}>{headline}</Text>
            {snippet && (
              <Text style={quote}>“{snippet}”</Text>
            )}
          </Section>

          <Section style={cta}>
            <Button style={button} href={href}>
              View on Materialize
            </Button>
            <Text style={small}>
              Or open this link:{" "}
              <Link style={link} href={href}>
                {href}
              </Link>
            </Text>
          </Section>

          <Hr style={hr} />

          <Section>
            <Text style={smallMuted}>
              You&apos;re receiving this because you have email notifications
              turned on. You can{" "}
              <Link style={link} href={settingsUrl}>
                turn them off
              </Link>{" "}
              from your account settings.
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
  fontSize: 20,
  fontWeight: 700,
  lineHeight: "1.3",
  margin: "8px 0 12px",
};

const quote: React.CSSProperties = {
  backgroundColor: "#fafafa",
  border: "1px solid #eee",
  borderLeft: "3px solid #ddd",
  borderRadius: 6,
  color: "#444",
  fontSize: 14,
  fontStyle: "italic",
  lineHeight: "1.5",
  margin: "12px 0",
  padding: "12px 14px",
};

const cta: React.CSSProperties = {
  margin: "20px 0 0",
  textAlign: "center" as const,
};

const button: React.CSSProperties = {
  backgroundColor: "#111",
  borderRadius: 8,
  color: "#fff",
  display: "inline-block",
  fontSize: 14,
  fontWeight: 600,
  padding: "12px 22px",
  textDecoration: "none",
};

const small: React.CSSProperties = {
  color: "#666",
  fontSize: 12,
  lineHeight: "1.5",
  margin: "12px 0 0",
};

const smallMuted: React.CSSProperties = {
  color: "#888",
  fontSize: 12,
  lineHeight: "1.5",
  margin: "8px 0 0",
};

const link: React.CSSProperties = {
  color: "#0058d6",
  textDecoration: "underline",
};

const hr: React.CSSProperties = {
  border: "none",
  borderTop: "1px solid #eee",
  margin: "24px 0",
};
