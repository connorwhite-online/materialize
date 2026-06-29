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
  };
}
