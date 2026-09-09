import { normaliseHref, type PhotoSource } from "@tj/domain/documents";

/**
 * The attribution content for a picked or credited picture, shared by the lesson's
 * `ImageCreditBadge` and the worksheet block toolbar (Images project).
 *
 * From `source`: "Photo by {photographer} on Pexels" with the photographer and Pexels links.
 * Else from legacy `credit`: the credit text and, when gated, a "View the original" link.
 * Imported lessons are untrusted JSON: every address goes through the same gate as a typed
 * link, and a refused one renders as plain text. No href, no anchor.
 */
export function ImageCreditText({
  source,
  credit,
  creditUrl,
}: {
  source?: PhotoSource;
  credit?: string;
  creditUrl?: string;
}) {
  if (source) {
    const photographerHref = normaliseHref(source.photographerUrl);
    const pageHref = normaliseHref(source.pageUrl);
    return (
      <p className="m-0 text-body text-ink-2">
        Photo by{" "}
        {photographerHref ? (
          <a href={photographerHref} target="_blank" rel="noopener noreferrer">
            {source.photographer}
          </a>
        ) : (
          source.photographer
        )}{" "}
        on{" "}
        {pageHref ? (
          <a href={pageHref} target="_blank" rel="noopener noreferrer">
            Pexels
          </a>
        ) : (
          "Pexels"
        )}
      </p>
    );
  }
  const href = creditUrl ? normaliseHref(creditUrl) : null;
  return (
    <div className="flex flex-col gap-1">
      <p className="m-0 break-words text-ink-2 text-meta">{credit}</p>
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="text-meta text-primary hover:underline"
        >
          View the original
        </a>
      ) : null}
    </div>
  );
}
