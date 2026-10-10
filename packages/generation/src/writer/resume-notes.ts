import { type WriterBundleId, writerBundle } from "./bundle";
import { type Brief, contextBlock, fillTemplate } from "./fixes";
import { localise } from "./locale";
import { lessonNotes, notesText, renderedLines } from "./notes";
import type { WriterServices } from "./services";

/*
 * The speaker notes for slides a retry keeps as saved (TEACH-312 part j). The writer writes its
 * notes after the editable deck, so a deck saved at editable by an attempt that then failed has
 * none. One notes call over the slides as saved, the same prompt and schema as the writer's
 * deck-wide call, fills them. Only `notes` changes: no slide's words, picture or diagram.
 */

type DeckSlide = {
  id: string;
  notes?: string;
  elements: unknown[];
};

/** The writer's primary slide id for deck position `k` (1-based): `s<k>`; continuations differ. */
const primaryIndex = (id: string): number | undefined => {
  const m = /^s(\d+)$/.exec(id);
  return m ? Number(m[1]) : undefined;
};

/** What a slide's pictures show, as the writer's notes call is told (`Picture: <alt>`). */
const pictureLines = (elements: unknown[]): string[] =>
  (elements as { type?: string; alt?: string }[])
    .filter((e) => e.type === "image")
    .map((e) => `Picture: ${e.alt ?? "a picture"}`);

/**
 * `slides` with speaker notes written for the primary slides from 3 on whose id is in `only` (all
 * of them when absent). A slide's own notes (the code's "On the slide: …" lines) follow the
 * written ones, as the writer joins them. A failed call leaves every slide as it was.
 */
export async function notesForSavedSlides<T extends DeckSlide>(o: {
  slides: T[];
  brief: Brief;
  objectives: string[];
  bundle?: WriterBundleId;
  services: Pick<WriterServices, "chat" | "log">;
  only?: ReadonlySet<string>;
}): Promise<T[]> {
  const P = writerBundle(o.bundle);
  const primaries = o.slides.filter((s) => primaryIndex(s.id) !== undefined);
  const n = Math.max(0, ...primaries.map((s) => primaryIndex(s.id) ?? 0));
  const wanted = primaries.filter(
    (s) => (primaryIndex(s.id) ?? 0) >= 3 && (o.only === undefined || o.only.has(s.id)),
  );
  if (wanted.length === 0) return o.slides;
  const objectives = o.objectives.map((t) => ({ teacher: t, pupil: "" }));
  const asShown = primaries
    .filter((s) => (primaryIndex(s.id) ?? 0) >= 3)
    .map((s) =>
      renderedLines(primaryIndex(s.id) ?? 0, s.elements as never, pictureLines(s.elements)),
    )
    .join("\n\n");
  const got = await lessonNotes({
    slides: n,
    first: 3,
    system: P.notes,
    user: fillTemplate(P.notesUser, o.brief, {
      objectives,
      context: contextBlock(o.brief, objectives, P.user),
      slidesAsShown: asShown,
    }),
    schema: JSON.parse(P.notesSchema),
    chat: (r) => o.services.chat({ ...r, system: localise(r.system), user: localise(r.user) }),
    log: (e) => o.services.log(e),
    onUsd: () => {},
  });
  const ids = new Set(wanted.map((s) => s.id));
  let written = 0;
  const out = o.slides.map((s) => {
    const k = primaryIndex(s.id);
    const text = k !== undefined && ids.has(s.id) ? notesText(got.get(k)) : "";
    if (!text) return s;
    written += 1;
    return { ...s, notes: [text, s.notes ?? ""].filter(Boolean).join("\n\n") };
  });
  o.services.log({ ev: "resume-notes", wanted: wanted.length, written });
  return out;
}
