import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Local-dev equivalents of the Netlify redirects in netlify.toml.  Browsers
// cannot call the Ark API cross-origin, so both dev and prod route Ark traffic
// through a same-origin path that is proxied at the edge / dev server.
export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: {
      "/proxy/ark": {
        target: "https://ark.cn-beijing.volces.com",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/proxy\/ark/, "/api/v3"),
      },
      "/proxy/openai": {
        target: "https://api.openai.com",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/proxy\/openai/, "/v1"),
      },
      "/proxy/codetab": {
        target: "https://api.code-tab.com",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/proxy\/codetab/, "/v1"),
      },
    },
  },
});
