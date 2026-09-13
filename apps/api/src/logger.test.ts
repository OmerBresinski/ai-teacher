import { expect, test } from "bun:test";
import { createLogger } from "./logger";

test("production logging does not copy error content into err or automatic msg", () => {
  const lines: string[] = [];
  const logger = createLogger(
    { NODE_ENV: "production", LOG_LEVEL: "trace" },
    {
      write: (line) => {
        lines.push(line);
      },
    },
  );
  const marker = "PRIVATE_API_CANARY_282";
  const error = Object.assign(new Error(marker, { cause: { token: marker } }), {
    params: [marker],
    responseBody: marker,
  });
  const child = logger.child({ request_id: "request-282" });
  child.error(error);
  child.error({ err: error });
  child.error({ err: error, operation: "create-document" }, "operation failed");
  child.warn({ error });
  const raw = lines.join("");
  expect(lines).toHaveLength(4);
  expect(raw).not.toContain(marker);
  expect(raw).not.toContain("stack");
  expect(raw).not.toContain("params");
  for (const line of lines) expect(JSON.parse(line).request_id).toBe("request-282");
  expect(raw).toContain("create-document");
});
