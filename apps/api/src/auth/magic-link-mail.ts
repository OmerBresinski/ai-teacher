/**
 * The magic-link email (ADR 0008, TEACH-35 follow-up). Table-based HTML so Gmail, Outlook and
 * Apple Mail render it the same: paper background, deep-green ink, one pill button with the
 * product's arrow, Plus Jakarta Sans where the client loads web fonts (Apple Mail, iOS) and the
 * system sans elsewhere (Gmail strips `@font-face`). The plain-text part carries the same words.
 *
 * Deliverability notes: a branded body with a button, an explanation of why the message arrived
 * and a visible sender beats a bare URL in Gmail's classifier; the URL itself is HTML-escaped
 * (query strings carry `&`).
 */

const PAPER = "#fbf8ee";
const INK = "#243428";
const INK_MUTED = "#5f6b62";
const HAIRLINE = "#d8d5c8";
const TERRACOTTA = "#d2644b";
const FONT =
  "'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

export const MAGIC_LINK_SUBJECT = "Your sign-in link for Teaching Journey";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function magicLinkText(url: string): string {
  return [
    "Teaching Journey",
    "",
    "Here is your sign-in link. It works once and expires in 5 minutes.",
    "",
    url,
    "",
    "You are getting this because someone entered your email address on the Teaching Journey sign-in page. If that was not you, there is nothing to do: the link only works from this message.",
  ].join("\n");
}

export function magicLinkHtml(url: string): string {
  const href = escapeHtml(url);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${MAGIC_LINK_SUBJECT}</title>
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@500;600;700&display=swap" rel="stylesheet">
<style>
  body { margin: 0; padding: 0; background: ${PAPER}; }
  a { color: ${INK}; }
  @media (max-width: 480px) {
    .wrap { padding: 32px 20px !important; }
    .h1 { font-size: 28px !important; line-height: 34px !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background:${PAPER};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">Your one-time sign-in link. It expires in 5 minutes.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${PAPER};">
  <tr>
    <td align="center" style="padding:0;">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="width:560px;max-width:100%;">
        <tr>
          <td class="wrap" style="padding:56px 40px 48px 40px;font-family:${FONT};color:${INK};">

            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td style="font-family:${FONT};font-size:22px;line-height:28px;font-weight:700;letter-spacing:-0.02em;color:${INK};">Teaching&nbsp;Journey<span style="color:${TERRACOTTA};">*</span></td>
                <td align="right" style="font-family:${FONT};font-size:14px;line-height:28px;color:${INK_MUTED};">Sign in</td>
              </tr>
            </table>

            <div style="height:64px;line-height:64px;font-size:0;">&nbsp;</div>

            <h1 class="h1" style="margin:0;font-family:${FONT};font-size:34px;line-height:40px;font-weight:700;letter-spacing:-0.02em;color:${INK};">Your sign-in link is ready.</h1>

            <p style="margin:16px 0 0 0;font-family:${FONT};font-size:17px;line-height:26px;color:${INK_MUTED};">It works once and expires in 5&nbsp;minutes.</p>

            <div style="height:36px;line-height:36px;font-size:0;">&nbsp;</div>

            <table role="presentation" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td style="border-radius:999px;background:${INK};">
                  <a href="${href}" style="display:inline-block;padding:18px 34px;font-family:${FONT};font-size:17px;line-height:22px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:999px;">Sign in to Teaching Journey&nbsp;&nbsp;<span style="font-weight:500;">&#8599;</span></a>
                </td>
              </tr>
            </table>

            <div style="height:48px;line-height:48px;font-size:0;">&nbsp;</div>

            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr><td style="border-top:2px solid ${HAIRLINE};font-size:0;line-height:0;">&nbsp;</td></tr>
            </table>

            <p style="margin:24px 0 0 0;font-family:${FONT};font-size:14px;line-height:22px;color:${INK_MUTED};">You are getting this because someone entered your email address on the Teaching Journey sign-in page. If that was not you, there is nothing to do: the link only works from this message.</p>

            <p style="margin:20px 0 0 0;font-family:${FONT};font-size:13px;line-height:20px;color:${INK_MUTED};">If the button does not work, paste this into your browser:<br><a href="${href}" style="color:${INK_MUTED};word-break:break-all;">${href}</a></p>

          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}

export function magicLinkMail(url: string): { subject: string; text: string; html: string } {
  return { subject: MAGIC_LINK_SUBJECT, text: magicLinkText(url), html: magicLinkHtml(url) };
}
