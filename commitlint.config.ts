import type { UserConfig } from "@commitlint/types";

// Conventional Commits (ADR 0015): `type(scope)?: subject`.
// Types allowed by config-conventional: build, chore, ci, docs, feat, fix, perf,
// refactor, revert, style, test.
const config: UserConfig = {
  extends: ["@commitlint/config-conventional"],
  rules: {
    // Long bodies are fine (PR bodies and generated changelogs land in commits on squash-merge).
    "body-max-line-length": [0, "always", Number.POSITIVE_INFINITY],
    "footer-max-line-length": [0, "always", Number.POSITIVE_INFINITY],
  },
};

export default config;
