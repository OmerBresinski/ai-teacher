import { normaliseHref, type PhotoSource } from "@tj/domain/documents";
import { creditSegments, photoCredit } from "../export/credits";

/**
 * The attribution content for a picked or credited picture, shared by the lesson's
 * `ImageCreditBadge` and the worksheet block toolbar (Images project).
 *
 * From `source`: the line `photoCredit` words for every export (Pexels: "Photo by {photographer}
 * on Pexels"; Commons: "{title}, {author}, {licence}", "cropped" when shown cut down; generated:
 * "Picture generated for this lesson"), its links in place. Else from legacy `credit`: the credit
 * text and, when gated, a "View the original" link. Imported lessons are untrusted JSON: every
 * address goes through the same gate as a typed link, and a refused one renders as plain text.
 */
export function ImageCreditText({
  source,
  credit,
  creditUrl,
  cropped,
}: {
  source?: PhotoSource;
  credit?: string;
  creditUrl?: string;
  /** The picture is shown cut down (`isCropped`): a CC BY or BY-SA credit says so. */
  cropped?: boolean;
}) {
  if (source) {
    const segments = creditSegments(photoCredit(source, { cropped: cropped ?? false }));
    return (
      <p className="m-0 break-words text-body text-ink-2">
        {segments.map((seg, i) =>
          seg.href ? (
            // biome-ignore lint/suspicious/noArrayIndexKey: segments are a fixed, ordered line
            <a key={i} href={seg.href} target="_blank" rel="noopener noreferrer">
              {seg.text}
            </a>
          ) : (
            // biome-ignore lint/suspicious/noArrayIndexKey: segments are a fixed, ordered line
            <span key={i}>{seg.text}</span>
          ),
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
