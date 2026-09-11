import { describe, expect, test } from "bun:test";
import pino from "pino";
import { silentLogger } from "../test-helpers";
import { RESEND_EMAILS_URL, ResendMailSender, ResendSendError } from "./resend";

const message = {
  to: "t@example.test",
  subject: "Your sign-in link",
  text: "Open https://api/auth/magic-link/verify?token=SECRET now",
  html: "<a href='https://api/auth/magic-link/verify?token=SECRET'>x</a>",
};

function fakeFetch(status: number, body: unknown) {
  const calls: { url: string; init: RequestInit }[] = [];
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
  return { calls, impl };
}

describe("ResendMailSender", () => {
  test("posts the message to Resend with the bearer key and sender", async () => {
    const { calls, impl } = fakeFetch(200, { id: "em_1" });
    const sender = new ResendMailSender(
      { apiKey: "re_test", from: "Teaching Journey <sign-in@mail.test>", fetch: impl },
      silentLogger,
    );
    await sender.send(message);

    expect(calls).toHaveLength(1);
    const call = calls[0];
    if (!call) throw new Error("no call");
    expect(call.url).toBe(RESEND_EMAILS_URL);
    expect(call.init.method).toBe("POST");
    expect((call.init.headers as Record<string, string>).Authorization).toBe("Bearer re_test");
    expect(JSON.parse(String(call.init.body))).toEqual({
      from: "Teaching Journey <sign-in@mail.test>",
      to: ["t@example.test"],
      subject: message.subject,
      text: message.text,
      html: message.html,
    });
  });

  test("a rejected message throws ResendSendError and never logs the body", async () => {
    const lines: string[] = [];
    const logger = pino(
      { level: "trace" },
      {
        write(line) {
          lines.push(line);
        },
      },
    );
    const { impl } = fakeFetch(422, { name: "validation_error", message: "bad from" });
    const sender = new ResendMailSender({ apiKey: "re_test", from: "x", fetch: impl }, logger);

    const err = await sender.send(message).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ResendSendError);
    expect((err as ResendSendError).status).toBe(422);
    expect((err as ResendSendError).message).toBe(
      "Resend rejected the message (HTTP 422, validation_error)",
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("validation_error");
    expect(lines[0]).not.toContain("SECRET");
    expect(lines[0]).not.toContain("re_test");
  });

  test("success logs the Resend id, not the link", async () => {
    const lines: string[] = [];
    const logger = pino(
      { level: "trace" },
      {
        write(line) {
          lines.push(line);
        },
      },
    );
    const { impl } = fakeFetch(200, { id: "em_1" });
    await new ResendMailSender({ apiKey: "re_test", from: "x", fetch: impl }, logger).send(message);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("em_1");
    expect(lines[0]).not.toContain("SECRET");
  });
});
