import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  define: {
    __VUE_OPTIONS_API__: false,
    __VUE_PROD_DEVTOOLS__: false,
    __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: false,
  },
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    port: 27183,
    strictPort: true,
    proxy: {
      "/api": "http://127.0.0.1:27184",
    },
  },
  preview: {
    host: "0.0.0.0",
    port: 27183,
    strictPort: true,
  },
});
