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
 * Resource hints for the cold load, production build only (the dev server is same-origin and serves
 * fonts from source):
 *
 * - `preconnect` to the API origin, so the DNS/TLS handshake for the first `GET /me` overlaps the
 *   script download instead of following it. `crossorigin="use-credentials"` matches the client's
 *   `credentials: "include"` fetches: a connection opened in a different credentials mode is not
 *   reused for them (HTML "obtain a connection", credentials flag).
 * - `preload` the two latin `.woff2` files every screen uses (Plus Jakarta Sans variable, Lora 500).
 *   Without it the browser discovers them only after the CSS is parsed and text is laid out, so the
 *   first frames paint in the fallback face and swap ~150 ms later. Other subsets stay lazy: their
 *   `unicode-range` means they download only when such text is present.
 */
function resourceHints(apiUrl: string): Plugin {
  const apiOrigin = /^https?:\/\//.test(apiUrl) ? new URL(apiUrl).origin : null;
  return {
    name: "tj:resource-hints",
    apply: "build",
    transformIndexHtml: {
      order: "post",
      handler(_html, ctx) {
        const tags: { tag: string; attrs: Record<string, string | boolean>; injectTo: "head" }[] =
          [];
        if (apiOrigin) {
          tags.push({
            tag: "link",
            attrs: { rel: "preconnect", href: apiOrigin },
            injectTo: "head",
          });
        }
        for (const fileName of Object.keys(ctx.bundle ?? {})) {
          if (!/(plus-jakarta-sans-latin-wght|lora-latin-500)-normal-[^/]*\.woff2$/.test(fileName))
            continue;
          tags.push({
            tag: "link",
            attrs: {
              rel: "preload",
              as: "font",
              type: "font/woff2",
              href: `/${fileName}`,
              crossorigin: true,
            },
            injectTo: "head",
          });
        }
        return tags;
      },
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
    plugins: [react(), tailwindcss(), themeInit(), resourceHints(env.VITE_API_URL ?? "")],
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
