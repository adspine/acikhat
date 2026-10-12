import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Panel /panel/ altında sunulur; derleme çıktısı sunucunun statik klasörüne gider
export default defineConfig({
  base: "/panel/",
  plugins: [react()],
  build: { outDir: "../web/panel", emptyOutDir: true },
  server: {
    // Geliştirmede API isteklerini yerel sunucuya aktar
    proxy: { "/api": "http://localhost:8787" },
  },
});
