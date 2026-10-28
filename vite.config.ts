import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  base: "./",
  plugins: [
    react(),
    {
      name: "development-csp",
      transformIndexHtml(html, context) {
        // Vite's React refresh preamble is inline. Allow it only in development.
        return context.server
          ? html.replace(
              "script-src 'self'",
              "script-src 'self' 'unsafe-inline'",
            )
          : html;
      },
    },
  ],
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    watch: {
      ignored: ["**/release/**", "**/tests/.tmp/**", "**/dist-electron/**"],
    },
  },
});
