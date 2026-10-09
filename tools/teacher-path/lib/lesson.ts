/**
 * What the teacher got, read from the saved document (and, for figures the document cannot show
 * were asked for, the worker's own log), plus an objective-coverage check independent of the
 * pipeline's metric.
 */
import { readFileSync } from "node:fs";
import { costUsd } from "../../../packages/ai/src/prices.ts";
import type { Doc } from "./teacher";

export type PictureSource = "stock" | "generated" | "library" | "diagram" | "other" | "missing";
export type Analysis = {
  slidesRequested: number;
  slidesDelivered: number;
  pictures: { slide: number; source: PictureSource; provider: string | null }[];
  pictureCounts: Record<PictureSource, number>;
  textOnlyTeaching: number[];
  figuresDropped: { slide: number; path: string }[] | null;
  objectives: string[];
  coverageCode: { checked: boolean; note: string; uncovered: number[] };
  coverageModel: {
    perObjective: { objective: number; taughtOn: number[]; checkedOn: number[] }[];
    covered: number;
    costUsd: number;
    note: string;
  } | null;
};

/** A uuidv7's first 48 bits are its creation time in ms. */
function uuidV7Ms(key: string): number | null {
  const hex = /([0-9a-f]{8})-([0-9a-f]{4})-7/.exec(key);
  return hex ? Number.parseInt(`${hex[1]}${hex[2]}`, 16) : null;
}

function classify(e: Doc, goMs: number): PictureSource {
  const src = String(e.src ?? "");
  if (!src) return "missing";
  if (e.name === "Diagram" || src.startsWith("data:image/svg") || /\.svg($|\?)/.test(src)) {
    return "diagram";
  }
  // A stored picture made before this lesson started was reused from the picture library.
  const made = uuidV7Ms(src.split("/").pop() ?? "");
  if (made !== null && made < goMs - 60_000) return "library";
  const provider = e.source?.provider;
  if (provider === "pexels" || provider === "commons") return "stock";
  if (provider === "generated") return "generated";
  return "other";
}

/** Every string a pupil sees on a slide: rich text, labels, options, questions. */
export function slideText(slide: Doc): string {
  const out: string[] = [];
  const walk = (v: unknown, key = "") => {
    if (typeof v === "string") {
      if (["text", "label", "stem", "prompt", "answer", "alt"].includes(key)) out.push(v);
    } else if (Array.isArray(v)) {
      for (const x of v) walk(x, key);
    } else if (v && typeof v === "object") {
      for (const [k, x] of Object.entries(v)) if (k !== "notes" && k !== "source") walk(x, k);
    }
  };
  walk(slide.elements);
  walk(slide.question);
  return out.join(" ").replace(/\s+/g, " ").trim();
}

export function analyse(opts: {
  doc: Doc;
  requested: number;
  goMs: number;
  excludedKinds: string[];
  workerLog?: { path: string; from: number; to: number };
}): Analysis {
  const { doc } = opts;
  const slides: Doc[] = doc.slides ?? [];
  const pictures: Analysis["pictures"] = [];
  const counts: Record<PictureSource, number> = {
    stock: 0,
    generated: 0,
    library: 0,
    diagram: 0,
    other: 0,
    missing: 0,
  };
  const textOnly: number[] = [];
  slides.forEach((s, i) => {
    const images = (s.elements ?? []).filter((e: Doc) => e.type === "image");
    for (const e of images) {
      const source = classify(e, opts.goMs);
      counts[source]++;
      pictures.push({ slide: i + 1, source, provider: e.source?.provider ?? null });
    }
    const teaching = !opts.excludedKinds.includes(s.kind) && !s.question;
    const shown = images.filter((e: Doc) => classify(e, opts.goMs) !== "missing");
    if (teaching && shown.length === 0) textOnly.push(i + 1);
  });

  let figuresDropped: Analysis["figuresDropped"] = null;
  if (opts.workerLog) {
    const text = readFileSync(opts.workerLog.path, "utf8").slice(
      opts.workerLog.from,
      opts.workerLog.to,
    );
    figuresDropped = [];
    for (const line of text.split("\n")) {
      if (!line.includes('"visual-path"')) continue;
      try {
        const raw = JSON.parse(line);
        // The worker nests the writer's events under `writer`.
        const j = raw.writer ?? raw;
        if (/dropped|^words/.test(String(j.path))) {
          figuresDropped.push({ slide: j.slide, path: j.path });
        }
      } catch {}
    }
  }

  const objectives: string[] = (doc.facts?.objectives ?? []).map((o: Doc) => String(o.text));
  // The writer's `teaches` per slide, when the saved document carries it.
  const flow: Doc[] | undefined = doc.generation?.flow ?? doc.plan?.flow;
  const perSlide = slides.map((s) => s.teaches as number[] | undefined);
  const teaches = flow?.map((f) => f.teaches as number[] | undefined) ?? perSlide;
  const has = teaches.some((t) => Array.isArray(t));
  const uncovered = has
    ? objectives.map((_, k) => k + 1).filter((k) => !teaches.some((t) => t?.includes(k)))
    : [];
  return {
    slidesRequested: opts.requested,
    slidesDelivered: slides.length,
    pictures,
    pictureCounts: counts,
    textOnlyTeaching: textOnly,
    figuresDropped,
    objectives,
    coverageCode: has
      ? { checked: true, note: "from `teaches` in the saved document", uncovered }
      : {
          checked: false,
          note: "the saved document carries no `teaches` (not persisted by this build)",
          uncovered: [],
        },
    coverageModel: null,
  };
}

/** One small-model call: which slides teach, and which check, each objective. */
export async function checkObjectives(opts: {
  doc: Doc;
  objectives: string[];
  model: string;
  priceId: string;
  apiKey: string;
}): Promise<NonNullable<Analysis["coverageModel"]>> {
  const slides: Doc[] = opts.doc.slides ?? [];
  const deck = slides
    .map(
      (s, i) =>
        `Slide ${i + 1} (${s.kind}${s.question ? `, ${s.question.type}` : ""}): ${slideText(s)}`,
    )
    .join("\n");
  const objectives = opts.objectives.map((o, i) => `${i + 1}. ${o}`).join("\n");
  const system = [
    "You audit a school lesson's slides against its learning objectives.",
    "For each objective, list the slides whose visible text teaches it (explains or models the knowledge or skill), and the slides that check it (a question or task a pupil answers that tests it).",
    "Judge only from the slide text given. A slide that merely names the topic does not teach it. A question about something else does not check it.",
    'Answer with JSON only: {"objectives":[{"objective":1,"taughtOn":[3,4],"checkedOn":[6]}]} with one entry per objective, in order.',
  ].join("\n");
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${opts.apiKey}` },
    body: JSON.stringify({
      model: opts.model,
      reasoning_effort: "low",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: `Objectives:\n${objectives}\n\nSlides:\n${deck}` },
      ],
    }),
  });
  if (!res.ok)
    throw new Error(`objective check ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const j = await res.json();
  const usage = j.usage ?? {};
  const cost =
    costUsd(opts.priceId, {
      inputTokens: usage.prompt_tokens ?? 0,
      outputTokens: usage.completion_tokens ?? 0,
      cachedInputTokens: usage.prompt_tokens_details?.cached_tokens ?? 0,
    }) ?? 0.02;
  const parsed = JSON.parse(j.choices?.[0]?.message?.content ?? "{}");
  const perObjective = opts.objectives.map((_, k) => {
    const row = (parsed.objectives ?? []).find((o: Doc) => o.objective === k + 1) ?? {};
    return {
      objective: k + 1,
      taughtOn: (row.taughtOn ?? []) as number[],
      checkedOn: (row.checkedOn ?? []) as number[],
    };
  });
  return {
    perObjective,
    covered: perObjective.filter((o) => o.taughtOn.length > 0 && o.checkedOn.length > 0).length,
    costUsd: cost,
    note: `${opts.model}, one call`,
  };
}
