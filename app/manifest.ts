import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Materialize",
    short_name: "Materialize",
    start_url: "/",
    display: "standalone",
    background_color: "#b5b5b0",
    theme_color: "#b5b5b0",
    icons: [
      {
        src: "/apple-icon.png",
        sizes: "1080x1080",
        type: "image/png",
      },
    ],
    screenshots: [
      {
        src: "/launch.png",
        sizes: "1080x1920",
        type: "image/png",
        // @ts-expect-error — "splash" is a valid form_factor per the spec but not yet in TS types
        form_factor: "narrow",
      },
    ],
  };
}
