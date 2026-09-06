// `mastra dev --dir packages/generation/src/mastra` looks for an `index.ts` exporting `mastra`
// (ADR 0025 §21). Everything lives in `../mastra.dev.ts`; this file only satisfies the CLI.
export { mastra } from "../mastra.dev";
