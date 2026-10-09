import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { generateRoute } from "../stages/picture-director";
import type { Brief } from "./fixes";
import type { VisualAsk, VisualState } from "./materialise";
import { replayServices } from "./replay-fixture";
import type { ChatReq } from "./services";
import { runWriter } from "./stage";

/*
 * WRITER-FIX-PLAN fault 3 (D51 y1 slides 3 and 10): a compare whose column 0 failed the picture
 * judge lost column 1's landed picture too (materialise's all-or-nothing drop), silently. The
 * failed column is now asked once more through generation; when that fails the drop is logged.
 */
const B = "y1-science-animals-young";
const DIR = join(import.meta.dir, "fixtures/replay", B);
const read = (f: string) => JSON.parse(readFileSync(join(DIR, f), "utf8"));
type El = Record<string, unknown>;
const photo = (k: string): VisualState => ({
  status: "photo",
  photo: { src: `/files/${k}.jpg`, alt: k, aspect: 4 / 3 },
});

async function run(retryLands: boolean | "no-placer", look = false) {
  const brief = read("brief.json") as Brief;
  const objectives = (
    read("objectives.json") as { objectives: { teacher: string }[] }
  ).objectives.map((o) => o.teacher);
  const main = read("main.json") as { text: string; finishReason?: string };
  if (look) {
    const out = JSON.parse(main.text) as { slides: { columns: { text: string }[] }[] };
    const col = out.slides[0]?.columns[0];
    if (col) col.text = `Look at the pictures. ${col.text}`;
    main.text = JSON.stringify(out);
  }
  const slideCalls: string[] = [];
  const events: El[] = [];
  const retried: VisualAsk[] = [];
  const placed = new Set<string>();
  // Slide 3 (index 2) is a compare: column 0 failed, column 1 landed. Every other slot failed.
  const visual = (i: number, key: string): VisualState => {
    const k = `${i}:${key}`;
    if (placed.has(k) || k === "2:col.1") return photo(k);
    return { status: "failed" };
  };
  const replay = replayServices(B);
  const res = await runWriter({
    brief,
    objectives,
    pupilWording: false,
    services: {
      ...replay,
      log: (e) => events.push(e as El),
      // A reroute this replay never recorded fails, as a failed call does.
      chat: (r: ChatReq) => {
        if (r.name === "slide" && r.user.includes("Adults and their young"))
          slideCalls.push(r.user);
        return replay.chat(r);
      },
    },
    visual,
    recordedWriter: { text: main.text, finishReason: main.finishReason ?? null },
    ...(retryLands === "no-placer"
      ? {}
      : {
          placeMore: async (i: number, more: VisualAsk[]) => {
            for (const a of more) {
              if (i === 2) retried.push(a);
              if (retryLands && i === 2) placed.add(`${i}:${a.key}`);
            }
          },
        }),
  });
  const images = ((res.slides[2]?.elements ?? []) as El[]).filter((e) => e.type === "image");
  return { events, retried, images, slideCalls, slide: res.plan.slides[2] as El };
}

describe("compare pictures (WRITER-FIX-PLAN fault 3)", () => {
  test("a failed column is retried through generation; both pictures land", async () => {
    const { events, retried, images } = await run(true);
    expect(retried).toEqual([
      expect.objectContaining({ key: "col.0", type: "photo", retry: "generate" }),
    ]);
    expect(images.map((e) => e.src)).toEqual(["/files/2:col.0.jpg", "/files/2:col.1.jpg"]);
    expect(events).toContainEqual({ ev: "compare-retry", slide: 3, cols: ["col.0"], ok: true });
    expect(events.some((e) => e.ev === "compare-pictures-dropped" && e.slide === 3)).toBe(false);
  }, 30_000);

  test("a retry that fails: no column shows a picture, and the drop is logged", async () => {
    const { events, images, slide } = await run(false);
    expect(events).toContainEqual({ ev: "compare-retry", slide: 3, cols: ["col.0"], ok: false });
    expect(slide.template).toBe("compare");
    expect(images).toEqual([]);
    const dropped = events.find((e) => e.ev === "compare-pictures-dropped" && e.slide === 3);
    expect(dropped?.failed).toContain("col.0");
  }, 30_000);

  test("with no placer there is no retry, and the drop is still logged", async () => {
    const { events, images } = await run("no-placer");
    expect(events.some((e) => e.ev === "compare-retry")).toBe(false);
    expect(images).toEqual([]);
    const dropped = events.find((e) => e.ev === "compare-pictures-dropped" && e.slide === 3);
    expect(dropped?.failed).toContain("col.0");
  }, 30_000);
});

describe("a compare whose retry failed stays a compare, text-only", () => {
  for (const mode of [false, "no-placer"] as const)
    test(`no reroute or restage (${mode === false ? "retry failed" : "no placer"})`, async () => {
      const { events, slideCalls, slide } = await run(mode);
      expect(slide.template).toBe("compare");
      expect(slideCalls).toEqual([]);
      const own = events.filter((e) => e.slide === 3).map((e) => e.ev);
      expect(own).not.toContain("repair");
      expect(own).not.toContain("restage-fallback");
      expect(events).toContainEqual({ ev: "compare-text-only", slide: 3 });
      expect(events).toContainEqual({
        ev: "visual-path",
        slide: 3,
        path: "picture-compare-text-only",
      });
    }, 30_000);
  test("its words stop pointing at the pictures", async () => {
    const { events, slide } = await run(false, true);
    const cols = slide.columns as { text: string }[];
    expect(cols[0]?.text).toBe("A young cow is a calf.");
    expect(events).toContainEqual(
      expect.objectContaining({ ev: "point-guard", slide: 3, how: "compare-strip" }),
    );
  }, 30_000);
  test("a retry that lands keeps the words as written", async () => {
    const { slide } = await run(true, true);
    expect((slide.columns as { text: string }[])[0]?.text).toBe(
      "Look at the pictures. A young cow is a calf.",
    );
  }, 30_000);
});

describe("generateRoute", () => {
  const d = (route: string) =>
    ({ route, pictures: [], named: null, period: null, count: null }) as never;
  test("a stock route goes to the library or the generator; the rest are kept", async () => {
    for (const [from, to] of [
      ["pexels", "library-or-generate"],
      ["library-or-generate", "library-or-generate"],
      ["commons", "commons"],
      ["code", "code"],
      ["none", "none"],
    ])
      expect(String((await generateRoute(async () => d(from as string))({} as never))?.route)).toBe(
        to as string,
      );
    expect(await generateRoute(async () => undefined)({} as never)).toBeUndefined();
  });
});
