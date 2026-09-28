/**
 * One clock for the agents step, shared by the 3D (bulges travelling the
 * hose, the M flashing as each lands — agent-desk.tsx) and the DOM (a
 * checklist item ticking as each lands — landing-hero.tsx). Seconds from
 * arriving on the step.
 */

/** When each bulge leaves the laptop. */
export const PACKET_LAUNCH_S = [0.9, 2.2, 3.5] as const;
/** Laptop → M, seconds. */
export const PACKET_TRAVEL_S = 1.25;

/** What each delivery completes, in order. */
export const AGENT_TASKS = [
  "Enclosure modeled",
  "Bill of materials uploaded",
  "Print order placed",
] as const;

/** When each task's bulge lands in the M (and its item ticks). */
export function arrivalS(i: number): number {
  return PACKET_LAUNCH_S[i] + PACKET_TRAVEL_S;
}
