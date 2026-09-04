import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// TODO(TEACH-22): move the shared React/jsdom Vitest preset into @tj/config and extend it here.
export default defineConfig({
  plugins: [react()],
  resolve: {
    // Honour `paths` from ./tsconfig.json (`@/*` → `./src/*`) without a plugin (Vite 8).
    tsconfigPaths: true,
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    css: true,
    include: ["src/**/*.test.{ts,tsx}"],
    env: { VITE_API_URL: "/api", VITE_APP_ENV: "development" },
  },
});
