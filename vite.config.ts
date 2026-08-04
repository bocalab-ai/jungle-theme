import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ command }) => ({
  base: command === "build" ? "/jungle-theme/" : "/",
  plugins: [react()],
  server: {
    host: true,
    allowedHosts: [".e2b.app"],
  },
}));
