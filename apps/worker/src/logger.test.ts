import { expect, test } from "bun:test";
import { createLogger } from "./logger";

test("worker production logger strips nested errors while retaining job diagnostics", () => {
  const lines: string[] = [];
  const logger = createLogger(
    { NODE_ENV: "production", LOG_LEVEL: "trace" },
    {
      write: (line) => {
        lines.push(line);
      },
    },
  );
  const marker = "PRIVATE_WORKER_CANARY_282";
  const error = Object.assign(new Error(marker, { cause: new Error(marker) }), {
    params: [marker],
    body: marker,
  });
  const child = logger.child({ jobId: "job-282", workspaceId: "workspace-282" });
  child.error(error);
  child.error({ err: error });
  child.warn({ error }, "job failed");
  expect(lines).toHaveLength(3);
  expect(lines.join("")).not.toContain(marker);
  for (const line of lines)
    expect(JSON.parse(line)).toMatchObject({ jobId: "job-282", workspaceId: "workspace-282" });
});
