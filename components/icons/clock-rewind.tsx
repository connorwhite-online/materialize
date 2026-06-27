import type { SVGProps } from "react";

/**
 * Clock with a counter-clockwise rewind arrow — used for the
 * "Builds" history section in the text-to-CAD studio. Custom glyph
 * supplied via iterate; strokes inherit currentColor.
 */
export function ClockRewind({
  size = 16,
  ...props
}: SVGProps<SVGSVGElement> & { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M3 5V9H7" />
      <path d="M3.51172 15C4.74723 18.4956 8.08094 21 11.9996 21C16.9702 21 20.9996 16.9706 20.9996 12C20.9996 7.02944 16.9702 3 11.9996 3C8.27045 3 5.07102 5.26806 3.70551 8.5" />
      <path d="M12 8V12L15 15" />
    </svg>
  );
}
