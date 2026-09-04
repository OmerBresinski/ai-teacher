import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv, type Plugin } from "vite";
// Relative on purpose: Vite's config loader externalises bare specifiers and hands them to Node,
// which cannot run `@tj/ui`'s extension-less TypeScript imports. Relative imports are bundled by
// Vite, so this is the only way to reuse the exact string at config time. Build-tool-only.
import { THEME_INIT_SCRIPT } from "../../packages/ui/src/theme/theme-init";

/**
 * Theme before first paint: replace the `<!--theme-init-->` marker in index.html with the inline
 * `THEME_INIT_SCRIPT` from `@tj/ui` (dependency-free ES5, never throws). Doing it here — rather
 * than from `main.tsx` — means the stored theme is applied before the stylesheet/bundle load, in
 * both `vite dev` and `vite build`, and the string can never drift from the provider's logic.
 */
function themeInit(): Plugin {
  return {
    name: "tj:theme-init",
    transformIndexHtml(html) {
      return html.replace("<!--theme-init-->", `<script>${THEME_INIT_SCRIPT}</script>`);
    },
  };
}

/**
 * Dev proxy decision (ADR 0008 "local development uses a Vite dev proxy"): the browser calls
 * `/api/*` on the Vite origin, Vite forwards to the API and strips the `/api` prefix (API routes
 * stay unprefixed: `/api/me` → `http://localhost:3001/me`). Cookies are therefore same-origin in
 * development. In production `VITE_API_URL` is the absolute API origin and no proxy exists.
 */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  const apiTarget = env.VITE_DEV_API_TARGET || "http://localhost:3001";

  return {
    plugins: [react(), tailwindcss(), themeInit()],
    resolve: {
      // Honour `paths` from ./tsconfig.json (`@/*` → `./src/*`) without a plugin (Vite 8).
      tsconfigPaths: true,
    },
    server: {
      proxy: {
        "/api": {
          target: apiTarget,
          changeOrigin: true,
          rewrite: (p) => p.replace(/^\/api/, ""),
          // SSE: strip `accept-encoding` so neither the API nor http-proxy compresses/buffers
          // the `text/event-stream` body (verified live against the TEACH-19 events routes).
          configure: (proxy) => {
            proxy.on("proxyReq", (proxyReq) => {
              proxyReq.removeHeader("accept-encoding");
            });
          },
        },
      },
    },
    build: {
      target: "es2022",
      manifest: true,
      reportCompressedSize: true,
      rollupOptions: {
        output: {
          // Vite 8 bundles with Rolldown: `manualChunks` is deprecated in favour of
          // `codeSplitting.groups` (rolldown 1.2). Keep React in its own long-lived chunk.
          codeSplitting: {
            groups: [{ name: "react", test: /node_modules\/(react|react-dom|scheduler)\// }],
          },
        },
      },
    },
  };
});
