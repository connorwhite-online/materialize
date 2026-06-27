import type { SVGProps } from "react";

/**
 * Stacked layers — used for the "Parametric source" section in the
 * text-to-CAD studio. Custom glyph supplied via iterate; fills
 * inherit currentColor.
 */
export function Layers({
  size = 16,
  ...props
}: SVGProps<SVGSVGElement> & { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      {...props}
    >
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M11.3161 3.1845C11.7576 3.02395 12.2416 3.02395 12.6831 3.1845L20.7569 6.12044C22.5123 6.75874 22.5123 9.2413 20.7569 9.87961L12.6831 12.8155C12.2416 12.9761 11.7576 12.9761 11.3161 12.8155L3.2423 9.87961C1.48695 9.2413 1.48693 6.75875 3.24229 6.12044L11.3161 3.1845ZM20.0734 8.00002L11.9996 5.06409L3.92578 8.00002L11.9996 10.936L20.0734 8.00002Z"
        fill="currentColor"
      />
      <path
        d="M20.7569 13.8796L12.6831 16.8155C12.2416 16.9761 11.7576 16.9761 11.3161 16.8155L3.2423 13.8796C2.10327 13.4654 1.70334 12.2747 2.04252 11.3152L11.9996 14.936L21.9567 11.3152C22.2959 12.2747 21.896 13.4654 20.7569 13.8796Z"
        fill="currentColor"
      />
      <path
        d="M20.7569 17.8796L12.6831 20.8155C12.2416 20.9761 11.7576 20.9761 11.3161 20.8155L3.2423 17.8796C2.10327 17.4654 1.70334 16.2747 2.04252 15.3152L11.9996 18.936L21.9567 15.3152C22.2959 16.2747 21.896 17.4654 20.7569 17.8796Z"
        fill="currentColor"
      />
    </svg>
  );
}
