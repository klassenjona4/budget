import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

const pkg = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8"),
) as { version: string };

// Deploying to a GitHub Pages project site needs a sub path base.
// Set BASE_PATH=/ for a root deployment.
const rawBase = process.env["BASE_PATH"] ?? "/budget/";
const base = rawBase.endsWith("/") ? rawBase : `${rawBase}/`;

export default defineConfig({
  base,
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_DATE__: JSON.stringify(new Date().toISOString().slice(0, 10)),
  },
  build: {
    target: "es2022",
    sourcemap: false,
  },
  plugins: [
    VitePWA({
      registerType: "autoUpdate",
      // The worker is hand written so it can handle the daily wake up.
      // See src/sw.ts. No Workbox runtime ships to the device.
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.ts",
      // No includeAssets: the glob below already covers every icon, and
      // listing them twice puts duplicate URLs in the precache manifest.
      manifest: {
        name: "Budget",
        short_name: "Budget",
        start_url: ".",
        scope: ".",
        display: "standalone",
        orientation: "portrait",
        background_color: "#0B1940",
        theme_color: "#0B1940",
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png" },
          {
            src: "icon-maskable-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      injectManifest: {
        globPatterns: ["**/*.{js,css,html,woff2,svg,png}"],
      },
    }),
  ],
});
