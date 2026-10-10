import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getTheme } from "@tj/slides/themes";
import type { DrawerCall } from "../writer/diagrams";
import type { Brief } from "../writer/fixes";
import type { VisualAsk, VisualState } from "../writer/materialise";
import type { ChatReq } from "../writer/services";
import { runWriter, type WriterOutput } from "../writer/stage";

/*
 * Register proofs (S7, 10 Oct 2026): each test reproduces one problem from the verified register
 * (scratchpad/problems/items.json) on origin/master, with the exact recorded writer slide or run.
 * Every assertion pins the BAD outcome that ships today. The fix PR for that problem inverts the
 * marked assertion (and renames the test from "BUG" to "FIXED"), so each fix is proven by a flip.
 * No model is called: the writer text is recorded, every chat and drawer call is refused.
 */

export const FIX = join(import.meta.dir, "fixtures");
export type J = Record<string, unknown>;
export const fixture = <T = J>(id: string): T =>
  JSON.parse(readFileSync(join(FIX, `${id}.json`), "utf8")) as T;
export const runFile = (run: string, f: string) => readFileSync(join(FIX, "runs", run, f), "utf8");
export const writerSlides = (run: string) =>
  (JSON.parse((JSON.parse(runFile(run, "main.json")) as { text: string }).text) as { slides: J[] })
    .slides;

export const theme = (stage: string) => getTheme(undefined as never, stage as never);

/** A photo every photo ask gets, so picture paths add no noise unless a test asks for failures. */
export const anyPhoto = (key: string): VisualState => ({
  status: "photo",
  photo: { src: `/files/${key}.jpg`, alt: key, aspect: 4 / 3, request: key },
});

/**
 * Replays a recorded writer output through master's writer stage. Writer specs are drawn by code;
 * a spec that needs the drawer gets no answer (the drawer call is refused, $0). Every chat call
 * (fit repair, restage, objective repair, notes) is refused, so a repair can only fail.
 */
export async function stageRun(
  run: string,
  o: { visual?: (i: number, key: string, a: VisualAsk) => VisualState } = {},
): Promise<{ out: WriterOutput; events: J[]; chats: string[] }> {
  const brief = JSON.parse(runFile(run, "brief.json")) as Brief;
  const objectives = (
    JSON.parse(runFile(run, "objectives.json")) as { objectives: { teacher: string }[] }
  ).objectives.map((x) => x.teacher);
  const main = JSON.parse(runFile(run, "main.json")) as { text: string; finishReason?: string };
  const events: J[] = [];
  const chats: string[] = [];
  const callDrawer: DrawerCall = async () => {
    throw new Error("no drawer call in a register proof");
  };
  const out = await runWriter({
    brief,
    objectives,
    services: {
      log: (e) => events.push(e as J),
      writer: () => Promise.reject(new Error("the proof never calls the writer")),
      chat: async (r: ChatReq) => {
        chats.push(r.name);
        throw new Error(`no paid call in a register proof: ${r.name}`);
      },
    },
    visual:
      o.visual ?? ((_i, key, a) => (a.type === "photo" ? anyPhoto(key) : { status: "failed" })),
    recordedWriter: { text: main.text, finishReason: main.finishReason ?? "stop" },
    drawDiagrams: { callDrawer },
  });
  return { out, events, chats };
}

/** Log slide numbers count the title as 1 and the objectives as 2; writer slide k is log k + 3. */
export const logSlide = (writerIndex: number) => writerIndex + 3;
export const eventsOf = (events: J[], slide: number) => events.filter((e) => e.slide === slide);
export const diagramEls = (els: unknown[]) =>
  (els as J[]).filter((e) => e.type === "image" && e.name === "Diagram");
