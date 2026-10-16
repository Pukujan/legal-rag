import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";
import { apiPlugin } from "./server/plugin";

export default defineConfig({
  plugins: [react(), apiPlugin()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "@shared": fileURLToPath(new URL("./shared", import.meta.url)),
    },
  },
  server: { host: true, allowedHosts: true },
  preview: { host: true, allowedHosts: true, port: 80, strictPort: true },
});
