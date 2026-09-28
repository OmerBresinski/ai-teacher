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

export const MAGIC_LINK_SUBJECT = "Sign in to DayBack";

/** How long a sign-in link stays valid (better-auth `magicLink({ expiresIn })`, TEACH-246). */
export const MAGIC_LINK_EXPIRES_IN_SECONDS = 15 * 60;

/** The web page the email links to; only its "Sign in" button spends the token (TEACH-246). */
export const MAGIC_LINK_CONFIRM_PATH = "/sign-in/confirm";

/**
 * A callback the confirm link may carry: a same-origin path, or an absolute http(s) URL whose
 * origin `isTrustedOrigin` accepts. Anything else is `undefined`, so an untrusted value never
 * reaches the email even though better-auth's own origin check would reject it later.
 */
function trustedCallback(
  value: string | null,
  isTrustedOrigin: (origin: string) => boolean,
): string | undefined {
  if (value === null) return undefined;
  if (/^\/(?![/\\])/.test(value)) return value;
  if (!URL.canParse(value)) return undefined;
  const url = new URL(value);
  const web = url.protocol === "http:" || url.protocol === "https:";
  return web && isTrustedOrigin(url.origin) ? value : undefined;
}

/**
 * The link the email carries. School mail scanners (Defender Safe Links and similar) GET every
 * link before the teacher sees it, and better-auth consumes the token on the first
 * `GET /magic-link/verify`, so the email points at a static web page instead and only its button
 * navigates to `verifyUrl`. The page lives on the origin the teacher asked from (the
 * `callbackURL`'s, when `isTrustedOrigin` accepts it, so a preview api mails its own preview web)
 * and otherwise on `fallbackOrigin` (`WEB_ORIGIN[0]`). An untrusted `callbackURL` becomes `/` and
 * an untrusted `errorCallbackURL` is left out (the page defaults it to `/sign-in`).
 */
export function confirmPageUrl(
  verifyUrl: string,
  fallbackOrigin: string,
  isTrustedOrigin: (origin: string) => boolean,
): string {
  const verify = new URL(verifyUrl);
  const callback = trustedCallback(verify.searchParams.get("callbackURL"), isTrustedOrigin) ?? "/";
  const errorCallback = trustedCallback(
    verify.searchParams.get("errorCallbackURL"),
    isTrustedOrigin,
  );
  const origin = URL.canParse(callback) ? new URL(callback).origin : fallbackOrigin;
  const confirm = new URL(MAGIC_LINK_CONFIRM_PATH, origin);
  confirm.searchParams.set("token", verify.searchParams.get("token") ?? "");
  confirm.searchParams.set("callbackURL", callback);
  if (errorCallback !== undefined) confirm.searchParams.set("errorCallbackURL", errorCallback);
  return confirm.toString();
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function magicLinkText(url: string): string {
  return [
    "DayBack",
    "",
    "Here is your sign-in link. It expires in 15 minutes.",
    "",
    url,
    "",
    "Didn't ask for this? You can ignore this email.",
  ].join("\n");
}

/** `assetOrigin` is the api's public origin (`BETTER_AUTH_URL`); it serves `/mail-assets/*`. */
export function magicLinkHtml(url: string, assetOrigin: string): string {
  const href = escapeHtml(url);
  const arrow = escapeHtml(`${assetOrigin.replace(/\/$/, "")}/mail-assets/arrow-up-right.png`);
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
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">Your sign-in link, valid for 15 minutes.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${PAPER};">
  <tr>
    <td align="center" style="padding:0;">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="width:560px;max-width:100%;">
        <tr>
          <td class="wrap" style="padding:56px 40px 48px 40px;font-family:${FONT};color:${INK};">

            <div style="font-family:${FONT};font-size:22px;line-height:28px;font-weight:700;letter-spacing:-0.02em;color:${INK};">Teaching&nbsp;Journey<span style="color:${TERRACOTTA};">*</span></div>

            <div style="height:64px;line-height:64px;font-size:0;">&nbsp;</div>

            <h1 class="h1" style="margin:0;font-family:${FONT};font-size:34px;line-height:40px;font-weight:700;letter-spacing:-0.02em;color:${INK};">Here is your sign-in link.</h1>

            <p style="margin:16px 0 0 0;font-family:${FONT};font-size:17px;line-height:26px;color:${INK_MUTED};">It expires in 15&nbsp;minutes.</p>

            <div style="height:36px;line-height:36px;font-size:0;">&nbsp;</div>

            <!-- The button: the product's pill, 16px text, ~56px tall; the arrow is a thin long
                 shaft with short arms, served as a PNG because Gmail drops inline SVG. -->
            <table role="presentation" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td style="border-radius:999px;background:${INK};">
                  <a href="${href}" style="display:block;padding:16px 26px 16px 28px;border-radius:999px;text-decoration:none;">
                    <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td style="font-family:${FONT};font-size:16px;line-height:24px;font-weight:600;color:#ffffff;white-space:nowrap;">Sign in to DayBack</td>
                        <td width="28" style="width:28px;font-size:0;line-height:0;">&nbsp;</td>
                        <td width="24" style="width:24px;vertical-align:middle;"><img src="${arrow}" width="24" height="24" alt="&#8599;" style="display:block;width:24px;height:24px;border:0;"></td>
                      </tr>
                    </table>
                  </a>
                </td>
              </tr>
            </table>

            <div style="height:48px;line-height:48px;font-size:0;">&nbsp;</div>

            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr><td style="border-top:2px solid ${HAIRLINE};font-size:0;line-height:0;">&nbsp;</td></tr>
            </table>

            <p style="margin:24px 0 0 0;font-family:${FONT};font-size:14px;line-height:22px;color:${INK_MUTED};">Didn&#8217;t ask for this? You can ignore this email.</p>

          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}

export function magicLinkMail(
  url: string,
  assetOrigin: string,
): { subject: string; text: string; html: string } {
  return {
    subject: MAGIC_LINK_SUBJECT,
    text: magicLinkText(url),
    html: magicLinkHtml(url, assetOrigin),
  };
}
