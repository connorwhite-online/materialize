/**
 * Anthropometric / ergonomic defaults for human-held parts. Numbers are
 * public-domain facts (ANSUR II — US Army, public domain; MIL-STD-1472 / NASA
 * HIDH — US-Gov public domain) plus consensus grip-diameter findings from the
 * ergonomics literature (facts, paraphrased). Applied only when the prompt
 * implies something held/worn/gripped, so they don't bloat every generation.
 *
 * Verify exact ANSUR II percentiles against the source CSV before treating
 * any value as precise; the figures here are safe working defaults.
 */
export const ERGONOMIC_RULES = `Ergonomic sizing (this part is held/worn/gripped) — accommodate the 5th–95th percentile (size clearances to large hands, reach/actuation to small):
- Power-grip handle diameter ≈ 35 mm (range 30–45); torque-heavy grip ≈ 55 mm; precision/pinch grip ≈ 12 mm.
- Handle clear length ≥ 100 mm so a large hand (95th-pct hand breadth ~95 mm) fits.
- Adjacent controls/knobs: ≥ ~15 mm finger clearance between them; knob diameter ≥ ~10 mm to turn comfortably.
- Add tactile signifiers where the hand acts: grip ridges, knurling, or a thumb recess.`;

const TRIGGERS =
  /\b(grip|handle|knob|dial|wearable|wear|ring|bracelet|watch|strap|holder|hold|ergonomic|tool|controller|joystick|trigger|pen|cup|mug)\b/i;

/** True when the prompt implies a human-interfacing part. */
export function needsErgonomics(prompt: string): boolean {
  return TRIGGERS.test(prompt);
}
