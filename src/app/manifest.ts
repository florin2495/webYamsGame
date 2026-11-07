import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Yams",
    short_name: "Yams",
    description: "Yams cu zaruri între prieteni, pe telefon.",
    id: "/yams/",
    start_url: "/yams/",
    scope: "/",
    display: "standalone",
    lang: "ro",
    background_color: "#09090b",
    theme_color: "#09090b",
    icons: [
      { src: "/yams/pwa-icons/192", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/yams/pwa-icons/512", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/yams/pwa-icons/maskable", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
