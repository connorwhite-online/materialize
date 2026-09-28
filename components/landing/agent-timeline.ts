/**
 * One clock for the agents step: bulges travel the hose (agent-desk.tsx)
 * and the printer's nozzle flares as each lands (toy-printer.tsx).
 * Seconds from arriving on the step.
 */

/** When each bulge leaves the laptop. */
export const PACKET_LAUNCH_S = [0.9, 2.2, 3.5] as const;
/** Laptop → platform port, seconds. */
export const PACKET_TRAVEL_S = 1.25;

/**
 * The live agent clock, written by agent-desk.tsx each frame and read by
 * the printer (toy-printer.tsx) so its nozzle flares exactly as
 * a bulge lands. Module-level like the shader uniforms: one scene.
 */
export const agentClock = {
  /** Seconds since arriving on the agents step. */
  t: 0,
  /** Seconds since the most recent delivery landed (large = none yet). */
  sinceArrival: 10,
};
