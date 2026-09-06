import { describe, expect, test } from "bun:test";
import {
  type CommandResult,
  type LandPrDeps,
  landPr,
  parseLandPrArgs,
  parseVercelProduction,
} from "./land-pr";
import { ExitCode, UserFacingError } from "./lib/exit";

const ok = (stdout = ""): CommandResult => ({ exitCode: 0, stdout });
const VERCEL_READY = `Age  Deployment  Status  Environment  Duration  Username
2m   https://preview.example.vercel.app  Ready  Preview  20s  omer
1m   https://teaching-journey-web.vercel.app  Ready  Production  21s  omer`;

interface FakeOptions {
  states?: string[];
  unresolved?: number;
  railway?: Partial<Record<"api" | "worker", Array<{ id: string; status?: string }>>>;
  vercel?: string;
  smokeExitCode?: number;
}

function fakeDeps(options: FakeOptions = {}): {
  deps: LandPrDeps;
  calls: { gh: string[][]; git: string[][]; railway: string[]; smoke: number };
} {
  const states = [...(options.states ?? ["CLEAN"])];
  const railway = {
    api: [...(options.railway?.api ?? [{ id: "old-api" }, { id: "new-api", status: "SUCCESS" }])],
    worker: [
      ...(options.railway?.worker ?? [
        { id: "old-worker" },
        { id: "new-worker", status: "SKIPPED" },
      ]),
    ],
  } as Record<"api" | "worker", Array<{ id: string; status?: string }>>;
  const lastRailway = {
    api: railway.api.at(-1) ?? { id: "old-api", status: "SUCCESS" },
    worker: railway.worker.at(-1) ?? { id: "old-worker", status: "SUCCESS" },
  };
  const calls = { gh: [] as string[][], git: [] as string[][], railway: [] as string[], smoke: 0 };
  let now = 0;
  let mergeCalls = 0;

  return {
    calls,
    deps: {
      gh: async (args) => {
        calls.gh.push(args);
        if (args[0] === "repo") return ok("owner/repo");
        if (args[0] === "api") {
          return ok(
            JSON.stringify({
              data: {
                repository: {
                  pullRequest: {
                    reviewThreads: {
                      nodes: Array.from({ length: options.unresolved ?? 0 }, () => ({
                        isResolved: false,
                      })),
                    },
                  },
                },
              },
            }),
          );
        }
        if (args[0] === "pr" && args[1] === "checks") return ok();
        if (
          args[0] === "pr" &&
          args[1] === "view" &&
          args.includes("mergeStateStatus,headRefName,headRefOid,state,isDraft")
        ) {
          return ok(
            JSON.stringify({
              mergeStateStatus: states.shift() ?? "CLEAN",
              headRefName: "chore/land-pr-script",
              headRefOid: "head",
              state: "OPEN",
              isDraft: false,
            }),
          );
        }
        if (args[0] === "pr" && args[1] === "merge") {
          mergeCalls += 1;
          return ok();
        }
        if (args[0] === "pr" && args[1] === "view" && args.includes("mergeCommit")) {
          return ok(mergeCalls === 1 ? "abc123" : "");
        }
        return ok();
      },
      git: async (args) => {
        calls.git.push(args);
        return ok();
      },
      vercelLs: async () => ok(options.vercel ?? VERCEL_READY),
      railwayList: async (service) => {
        calls.railway.push(service);
        const deployment = railway[service].shift() ?? lastRailway[service];
        return ok(JSON.stringify([deployment]));
      },
      smoke: async () => {
        calls.smoke += 1;
        return { exitCode: options.smokeExitCode ?? 0, stdout: "" };
      },
      sleep: async (ms) => {
        now += ms;
      },
      now: () => now,
    },
  };
}

describe("land-pr", () => {
  test("lands a clean PR and reports every green check", async () => {
    const fake = fakeDeps();
    const summary = await landPr(42, {}, fake.deps);

    expect(summary.ok).toBe(true);
    expect(summary.ci.ok).toBe(true);
    expect(summary.vercel.status).toBe("Ready");
    expect(summary.railway.api.status).toBe("SUCCESS");
    expect(summary.railway.worker.status).toBe("SKIPPED");
    expect(summary.smoke.status).toBe("passed");
  });

  test("rebases one BEHIND round before merging", async () => {
    const fake = fakeDeps({ states: ["BEHIND", "CLEAN"] });
    await landPr(42, {}, fake.deps);

    expect(fake.calls.git).toEqual([
      ["fetch", "origin"],
      ["checkout", "chore/land-pr-script"],
      ["rebase", "origin/master"],
      ["push", "--force-with-lease"],
    ]);
  });

  test("stops after two rebase rounds", async () => {
    const fake = fakeDeps({ states: ["BEHIND", "BEHIND", "BEHIND"] });
    await expect(landPr(42, {}, fake.deps)).rejects.toThrow(
      "remained BEHIND after 2 rebase rounds",
    );
    expect(fake.calls.git.filter((args) => args[0] === "push")).toHaveLength(2);
  });

  test("refuses unresolved review threads before merging", async () => {
    const fake = fakeDeps({ unresolved: 2 });
    await expect(landPr(42, {}, fake.deps)).rejects.toThrow("2 unresolved review thread");
    expect(fake.calls.gh.some((args) => args[0] === "pr" && args[1] === "merge")).toBe(false);
  });

  test("refuses a PR with merge conflicts", async () => {
    const fake = fakeDeps({ states: ["DIRTY"] });
    await expect(landPr(42, {}, fake.deps)).rejects.toThrow("merge conflicts");
    expect(fake.calls.gh.some((args) => args[0] === "pr" && args[1] === "merge")).toBe(false);
  });

  test("reports a watch-path-filtered Railway service as skipped", async () => {
    const fake = fakeDeps({
      railway: {
        api: [{ id: "old-api" }, { id: "new-api", status: "SUCCESS" }],
        worker: [{ id: "old-worker" }, { id: "old-worker" }, { id: "old-worker" }],
      },
    });
    const summary = await landPr(42, { timeoutMin: 2 }, fake.deps);
    expect(summary.railway.worker.status).toBe("SKIPPED (no new deployment)");
  });

  test("fails a Railway deployment with its logs command", async () => {
    const fake = fakeDeps({
      railway: {
        api: [{ id: "old-api" }, { id: "new-api", status: "FAILED" }],
      },
    });
    await expect(landPr(42, {}, fake.deps)).rejects.toThrow(
      "railway logs -p a79752e1-8bf5-41d0-b832-f1b64aaf6d2f",
    );
  });

  test("fails a Vercel Production Error deployment", async () => {
    const fake = fakeDeps({
      vercel: VERCEL_READY.replace("Ready  Production", "Error  Production"),
    });
    await expect(landPr(42, {}, fake.deps)).rejects.toThrow("Vercel Production deployment failed");
  });

  test("skips deploy and smoke when requested", async () => {
    const fake = fakeDeps();
    const summary = await landPr(42, { deploy: false, smoke: false }, fake.deps);
    expect(summary.vercel.status).toBe("skipped");
    expect(summary.railway.api.status).toBe("skipped");
    expect(summary.smoke.status).toBe("skipped");
    expect(fake.calls.railway).toHaveLength(0);
    expect(fake.calls.smoke).toBe(0);
  });

  test("finds the Production status in a Vercel table with a Preview above it", () => {
    expect(parseVercelProduction(VERCEL_READY)).toBe("Ready");
  });

  test("rejects missing and non-numeric PR numbers as usage errors", () => {
    for (const args of [[], ["abc"]]) {
      try {
        parseLandPrArgs(args);
        throw new Error("expected usage error");
      } catch (error) {
        expect(error).toBeInstanceOf(UserFacingError);
        expect((error as UserFacingError).exitCode).toBe(ExitCode.Usage);
      }
    }
  });
});
