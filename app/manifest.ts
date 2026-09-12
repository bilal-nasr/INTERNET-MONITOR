import type { MetadataRoute } from "next";
import { en } from "@/lib/i18n/dictionaries/en";

/**
 * Served at /manifest.webmanifest. The name is the English one: a manifest has
 * one name, and the install prompt shows it before any language is chosen.
 * start_url is "/", which the proxy redirects into the remembered language.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: en.meta.appName,
    short_name: "Quota",
    description: en.meta.appDescription,
    start_url: "/",
    display: "standalone",
    background_color: "#fafaf9",
    theme_color: "#171717",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
    ],
  };
}
