import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  publicDir: mode === "apk" ? false : "public",
  server: { port: 5173, proxy: { "/api": "http://127.0.0.1:3001" } },
  build: {
    outDir: mode === "apk" ? "dist-apk" : "dist",
    rollupOptions: {
      input: mode === "apk" ? "android.html" : "index.html",
    },
  },
}));
