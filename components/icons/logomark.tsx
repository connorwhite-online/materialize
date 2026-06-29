import type { SVGProps } from "react";

/**
 * Materialize "M" logomark. Used as the sidebar nav brand (replacing the
 * Frama wordmark) and is the same glyph as the favicon / app icons. Fill
 * inherits currentColor so it follows the surrounding text color in both
 * light and dark themes.
 */
export function Logomark({
  height = 20,
  ...props
}: SVGProps<SVGSVGElement> & { height?: number }) {
  return (
    <svg
      height={height}
      viewBox="0 0 474 250"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      {...props}
    >
      <path d="M105.405 18.2404L4.7383 195.74C-8.87232 219.739 8.463 249.5 36.0528 249.5H150.941C156.695 249.5 162.006 246.41 164.85 241.408L215.795 151.803C219.854 144.663 230.749 147.544 230.749 155.757V241.5C230.749 245.918 234.331 249.5 238.749 249.5H281.595C284.472 249.5 287.128 247.955 288.55 245.454L341.795 151.803C345.854 144.663 356.749 147.544 356.749 155.757V234C356.749 242.837 363.913 250 372.749 250H437.749C457.632 250 473.749 233.882 473.749 214V36C473.749 16.1177 457.632 0 437.749 0H363.339C359.118 0 355.068 1.66818 352.071 4.64112L272.422 83.6553C265.822 90.2024 255.246 82.1233 259.827 74.0339L294.987 11.942C298.007 6.60893 294.154 0 288.026 0H136.719C123.759 0 111.798 6.96671 105.405 18.2404Z" />
    </svg>
  );
}
