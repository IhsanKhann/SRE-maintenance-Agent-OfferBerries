import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    proxy: {
      "/api": {
        target: "http://localhost:3500",
        changeOrigin: true,
      },
      "/socket.io": {
        target: "http://localhost:3500",
        ws: true,
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ["react", "react-dom"],
          socket: ["socket.io-client"],
          charts: ["recharts"],
        },
      },
    },
  },
  define: {
    "import.meta.env.VITE_SRE_URL": JSON.stringify(process.env.VITE_SRE_URL ?? "http://localhost:3500"),
  },
});
