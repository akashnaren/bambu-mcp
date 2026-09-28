import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
  root: "web",
  plugins: [tailwindcss()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    cssCodeSplit: false,
    target: "es2022",
  },
});
