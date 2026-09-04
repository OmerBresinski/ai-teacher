/**
 * Outbound mail for `@tj/api` — today only the magic-link email (ADR 0008).
 *
 * `MailSender` is the seam F17 fills with a real provider. Until then `MAIL_PROVIDER=console`
 * prints the message (and therefore the magic link) to the api log, and tests use
 * `CaptureMailSender` to read the link back.
 */
import type { Env } from "../env";
import type { Logger } from "../logger";

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface MailSender {
  send(message: MailMessage): Promise<void>;
}

const RULE = "═".repeat(78);

/** Logs each message at `info` inside a clearly boxed block so the link is easy to spot. */
export class ConsoleMailSender implements MailSender {
  constructor(private readonly logger: Logger) {}

  async send(message: MailMessage): Promise<void> {
    const block = [
      "",
      RULE,
      `  MAIL (MAIL_PROVIDER=console) → ${message.to}`,
      `  Subject: ${message.subject}`,
      "",
      ...message.text.split("\n").map((line) => `  ${line}`),
      RULE,
      "",
    ].join("\n");
    this.logger.info({ to: message.to, subject: message.subject }, block);
  }
}

/**
 * Keeps every message in memory so the magic link can be read back — by unit tests (`last`) and
 * by the test-only `GET /__test/last-magic-link` route (`lastFor(email)`, TEACH-22). When
 * `forwardTo` is given the message is also delivered through it (the api process in
 * `NODE_ENV=test` wraps the console sender so the link is still printed).
 */
export class CaptureMailSender implements MailSender {
  readonly all: MailMessage[] = [];

  constructor(private readonly forwardTo?: MailSender) {}

  get last(): MailMessage | undefined {
    return this.all.at(-1);
  }

  /** Most recent message addressed to `email` (case-insensitive), or `undefined`. */
  lastFor(email: string): MailMessage | undefined {
    const wanted = email.trim().toLowerCase();
    return this.all.findLast((m) => m.to.toLowerCase() === wanted);
  }

  async send(message: MailMessage): Promise<void> {
    this.all.push(message);
    await this.forwardTo?.send(message);
  }

  clear(): void {
    this.all.length = 0;
  }
}

/** Pick the sender for `MAIL_PROVIDER`. Anything but `console` is a boot error until F17. */
export function createMailSender(env: Pick<Env, "MAIL_PROVIDER">, logger: Logger): MailSender {
  if (env.MAIL_PROVIDER === "console") return new ConsoleMailSender(logger);
  throw new Error(
    `MAIL_PROVIDER: only "console" is supported until F17 (got "${env.MAIL_PROVIDER}")`,
  );
}

/** Boot-time wrapper: an unsupported `MAIL_PROVIDER` prints one readable line and exits 1. */
export function loadMailSender(env: Pick<Env, "MAIL_PROVIDER">, logger: Logger): MailSender {
  try {
    return createMailSender(env, logger);
  } catch (err) {
    process.stderr.write(`Invalid environment for @tj/api:\n${(err as Error).message}\n`);
    process.exit(1);
  }
}

/** Extract the first `http(s)://…` URL from a message body (used by tests and smoke scripts). */
export function extractFirstUrl(text: string): string | undefined {
  return /https?:\/\/\S+/.exec(text)?.[0];
}
