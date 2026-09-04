import { describe, expect, test } from "bun:test";
import { silentLogger } from "../test-helpers";
import { CaptureMailSender, ConsoleMailSender, createMailSender, extractFirstUrl } from "./index";

describe("mail", () => {
  test("createMailSender: console → ConsoleMailSender", () => {
    expect(createMailSender({ MAIL_PROVIDER: "console" }, silentLogger)).toBeInstanceOf(
      ConsoleMailSender,
    );
  });

  test("createMailSender: anything else fails readably", () => {
    expect(() => createMailSender({ MAIL_PROVIDER: "smtp" }, silentLogger)).toThrow(
      'MAIL_PROVIDER: only "console" is supported until F17 (got "smtp")',
    );
  });

  test("ConsoleMailSender logs a boxed block containing the link at info", async () => {
    const lines: string[] = [];
    const logger = {
      ...silentLogger,
      info: (_obj: unknown, msg: string) => lines.push(msg),
    } as unknown as typeof silentLogger;
    await new ConsoleMailSender(logger).send({
      to: "t@example.test",
      subject: "Hi",
      text: "Open http://localhost:3001/auth/magic-link/verify?token=abc now",
    });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("═══");
    expect(lines[0]).toContain("MAIL (MAIL_PROVIDER=console) → t@example.test");
    expect(lines[0]).toContain("http://localhost:3001/auth/magic-link/verify?token=abc");
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
