-- TEACH-275: documents store their own pictures as the api path `/files/<key>`; the origin is a
-- render-time input. Rewrite every absolute `<scheme>://<host>/files/` reference (slide images,
-- slide backgrounds, worksheet image blocks) to the relative form. The pattern is anchored on
-- `/files/` directly after a host, so a third party's picture URL is never touched. Idempotent.
UPDATE "documents"
SET "body" = regexp_replace("body"::text, 'https?://[^/"]+/files/', '/files/', 'g')::jsonb
WHERE "body"::text ~ 'https?://[^/"]+/files/';
