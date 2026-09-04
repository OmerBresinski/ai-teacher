/**
 * Types for the jest-dom matchers registered in `./setup.ts`. `@testing-library/jest-dom` ships
 * `types/bun.d.ts` but does not export it from `package.json#exports`, so React workspaces
 * reference this copy from `tsconfig.json#compilerOptions.types`
 * (`"@tj/config/bun-test/jest-dom"`) to teach Bun's `expect` about `toBeInTheDocument()` & co.
 */
import type { expect } from "bun:test";
import type { TestingLibraryMatchers } from "@testing-library/jest-dom/matchers";

declare module "bun:test" {
  // biome-ignore lint/suspicious/noExplicitAny: mirrors jest-dom's own `types/bun.d.ts`
  interface Matchers<T = any>
    extends TestingLibraryMatchers<ReturnType<typeof expect.stringContaining>, T> {}
}
