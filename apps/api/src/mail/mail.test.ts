import { describe, expect, test } from "bun:test";
import pino from "pino";
import { silentLogger, TEST_ENV } from "../test-helpers";
import { CaptureMailSender, ConsoleMailSender, createMailSender, extractFirstUrl } from "./index";

describe("mail", () => {
  test("createMailSender: console → ConsoleMailSender", () => {
    expect(createMailSender(TEST_ENV, silentLogger)).toBeInstanceOf(ConsoleMailSender);
  });

  test("createMailSender: anything else fails readably", () => {
    expect(() => createMailSender({ ...TEST_ENV, MAIL_PROVIDER: "smtp" }, silentLogger)).toThrow(
      'MAIL_PROVIDER: only "console" is supported until F17 (got "smtp")',
    );
  });

  test("ConsoleMailSender logs the production sign-in link at warn", async () => {
    const lines: string[] = [];
    const logger = pino(
      { level: "trace" },
      {
        write(line) {
          lines.push(line);
        },
      },
    );
    const url = "https://api/auth/magic-link/verify?token=SECRET";
    await new ConsoleMailSender(logger, { NODE_ENV: "production" }).send({
      to: "t@example.test",
      subject: "Hi",
      text: `Open ${url} now`,
    });
    expect(lines).toHaveLength(1);
    const line = JSON.parse(lines[0] ?? "") as { level: number; msg: string };
    expect(line.level).toBe(40);
    expect(line.msg).toContain("SIGN-IN LINK IN LOG");
    expect(line.msg).toContain("ALLOW_CONSOLE_MAIL_IN_PRODUCTION");
    expect(line.msg).toContain(url);
  });

  test("ConsoleMailSender keeps the development info block unchanged", async () => {
    const lines: string[] = [];
    const logger = pino(
      { level: "trace" },
      {
        write(line) {
          lines.push(line);
        },
      },
    );
    const url = "http://localhost:3001/auth/magic-link/verify?token=abc";
    await new ConsoleMailSender(logger, { NODE_ENV: "development" }).send({
      to: "t@example.test",
      subject: "Hi",
      text: `Open ${url} now`,
    });
    expect(lines).toHaveLength(1);
    const line = JSON.parse(lines[0] ?? "") as { level: number; msg: string };
    expect(line.level).toBe(30);
    expect(line.msg).toContain("═══");
    expect(line.msg).toContain("MAIL (MAIL_PROVIDER=console) → t@example.test");
    expect(line.msg).toContain(url);
    expect(line.msg).not.toContain("SIGN-IN LINK IN LOG");
  });

  test("CaptureMailSender keeps every message", async () => {
    const m = new CaptureMailSender();
    await m.send({ to: "a", subject: "s", text: "one" });
    await m.send({ to: "b", subject: "s", text: "two" });
    expect(m.all).toHaveLength(2);
    expect(m.last?.text).toBe("two");
    m.clear();
    expect(m.last).toBeUndefined();
  });

  test("extractFirstUrl", () => {
    expect(extractFirstUrl("go to https://x.test/a?b=1 now")).toBe("https://x.test/a?b=1");
    expect(extractFirstUrl("nothing")).toBeUndefined();
  });
});
