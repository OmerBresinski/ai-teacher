/**
 * `MailSender` backed by Resend's REST API (TEACH-35). One endpoint, so plain `fetch` rather
 * than the SDK. The domain is verified in Resend's EU region (`eu-west-1`, ADR 0016); the key
 * is a send-only API key set on Railway as `RESEND_API_KEY`.
 *
 * Never logs the message body: the text carries the magic link.
 */
import type { Logger } from "../logger";
import type { MailMessage, MailSender } from "./index";

export const RESEND_EMAILS_URL = "https://api.resend.com/emails";

export interface ResendMailSenderOptions {
  apiKey: string;
  /** RFC 5322 sender, e.g. `Teaching Journey <sign-in@mail.example.org>`. */
  from: string;
  /** Injected in tests; defaults to the global `fetch`. */
  fetch?: typeof fetch;
}

interface ResendErrorBody {
  name?: string;
  message?: string;
}

const RESEND_ERROR_NAMES = new Set([
  "validation_error",
  "missing_required_field",
  "invalid_access",
  "invalid_parameter",
  "invalid_api_key",
  "restricted_api_key",
  "rate_limit_exceeded",
  "application_error",
]);

function safeResendName(value: unknown): string | undefined {
  return typeof value === "string" && RESEND_ERROR_NAMES.has(value) ? value : undefined;
}

/** Thrown when Resend does not accept the message; `status` and `name` are safe to log. */
export class ResendSendError extends Error {
  constructor(
    readonly status: number,
    readonly resendName: string | undefined,
  ) {
    super(`Resend rejected the message (HTTP ${status}${resendName ? `, ${resendName}` : ""})`);
    this.name = "ResendSendError";
  }
}

export class ResendMailSender implements MailSender {
  private readonly fetchImpl: typeof fetch;

  constructor(
    private readonly options: ResendMailSenderOptions,
    private readonly logger: Logger,
  ) {
    this.fetchImpl = options.fetch ?? fetch;
  }

  async send(message: MailMessage): Promise<void> {
    const response = await this.fetchImpl(RESEND_EMAILS_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.options.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: this.options.from,
        to: [message.to],
        subject: message.subject,
        text: message.text,
        ...(message.html ? { html: message.html } : {}),
      }),
    });

    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as ResendErrorBody;
      const name = safeResendName(body.name);
      this.logger.error(
        { status: response.status, resendError: name },
        "mail: Resend rejected the message",
      );
      throw new ResendSendError(response.status, name);
    }

    const { id } = (await response.json().catch(() => ({}))) as { id?: string };
    this.logger.info({ to: message.to, resendId: id }, "mail: sent via Resend");
  }
}
