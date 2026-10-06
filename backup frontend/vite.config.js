import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const proxy = {
    target: env.VITE_API_PROXY_TARGET || "http://localhost:3000",
    changeOrigin: true,
    rewrite: (path) => path.replace(/^\/api/, ""),
    configure(proxyServer) {
      proxyServer.on("error", (_error, request, response) => {
        if (response.headersSent) return;
        response.writeHead(502, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ error: { message: "Backend unavailable" } }));
      });
    },
  };

  return {
    plugins: [react()],
    server: { proxy: { "/api": proxy } },
    preview: { proxy: { "/api": proxy } },
  };
});