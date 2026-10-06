// Arm C: the tool set, its state machine and the limits (C-tools.md is the contract).
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DrawDiagram } from "./diagrams.ts";
import type { Geometry } from "./geometry.ts";
import { wrap } from "./page.ts";
import type { FindPicture } from "./pictures.ts";
import { PROBE_IDS, type Probe, type ProbeAnswer } from "./probes.ts";
import type { Renderer } from "./renderer.ts";
import type { Tokens } from "./tokens.ts";

export const MAX_RENDERS = 3; // the first render plus 2 repair rounds
const KINDS = [
  "particles",
  "hydrograph",
  "timeline",
  "layers",
  "cycle",
  "river",
  "bar-model",
  "line-graph",
  "flow",
  "labelled-diagram",
  "number-line",
  "table",
];

const S = (description = "") => ({ type: "string", description });
const N = (description = "") => ({ type: "number", description });
/** Parameter schemas (fixed by code). Descriptions come from prompts/tool-descriptions.json. */
export const SCHEMAS: Record<string, { properties: Record<string, any>; required: string[] }> = {
  set_plan: {
    properties: {
      title: S(),
      objectives: {
        type: "array",
        items: {
          type: "object",
          properties: { teacher: S(), pupil: S() },
          required: ["teacher", "pupil"],
        },
      },
      flow: {
        type: "array",
        items: {
          type: "object",
          properties: { slide: { type: "integer" }, does: S(), pupils_see: S() },
          required: ["slide", "does", "pupils_see"],
        },
      },
    },
    required: ["title", "objectives", "flow"],
  },
  find_picture: {
    properties: {
      slide: { type: "integer" },
      request: S(),
      kind: { type: "string", enum: ["named", "generic"] },
      period: S(),
      aspect: N(),
    },
    required: ["slide", "request", "kind"],
  },
  draw_diagram: {
    properties: {
      slide: { type: "integer" },
      kind: { type: "string", enum: KINDS },
      request: S(),
      width: N(),
      height: N(),
    },
    required: ["slide", "kind", "request", "width", "height"],
  },
  render_slide: {
    properties: { slide: { type: "integer" }, html: S() },
    required: ["slide", "html"],
  },
  probe_slide: {
    properties: {
      slide: { type: "integer" },
      questions: {
        type: "array",
        items: { type: "string", enum: [...PROBE_IDS] },
        minItems: 1,
        maxItems: 5,
      },
    },
    required: ["slide", "questions"],
  },
  submit_slide: { properties: { slide: { type: "integer" }, notes: S() }, required: ["slide"] },
  finish: { properties: {}, required: [] },
};

export function toolDefs(desc: Record<string, string>) {
  return Object.entries(SCHEMAS).map(([name, s]) => ({
    type: "function" as const,
    strict: false,
    name,
    description: desc[name] ?? "",
    parameters: {
      type: "object",
      properties: Object.fromEntries(
        Object.entries(s.properties).map(([k, v]) => [
          k,
          { ...v, description: desc[`${name}.${k}`] ?? v.description ?? "" },
        ]),
      ),
      required: s.required,
    },
  }));
}

interface Render {
  n: number;
  html: string;
  file: string;
  geometry: Geometry;
  probe?: ProbeAnswer[];
}
interface SlideState {
  renders: Render[];
  submitted?: { render: number; notes: string; at: number };
  pictures: string[];
  diagrams: string[];
}
export interface Plan {
  title: string;
  objectives: { teacher: string; pupil: string }[];
  flow: { slide: number; does: string; pupils_see: string }[];
}

export class Lesson {
  plan?: Plan;
  slides = new Map<number, SlideState>();
  timings: Record<string, number | null> = {
    title: null,
    first_teaching_slide: null,
    editable: null,
    last_visual: null,
  };
  pictures: Record<string, unknown> = {};
  diagrams: Record<string, unknown> = {};
  finishCalls = 0;
  done = false;
  turnsLeft = 0;
  private seq = 0;
  constructor(
    private o: {
      runDir: string;
      tk: Tokens;
      slideCount: number;
      slideMin: number;
      slideMax: number;
      t0: number;
      renderer: Renderer;
      findPicture: FindPicture;
      drawDiagram: DrawDiagram;
      probe: Probe;
    },
  ) {}
  private ms = () => Math.round(performance.now() - this.o.t0);
  private slide(n: number): SlideState {
    if (!this.slides.has(n)) this.slides.set(n, { renders: [], pictures: [], diagrams: [] });
    return this.slides.get(n)!;
  }
  private valid = (n: unknown) =>
    Number.isInteger(n) && (n as number) >= 1 && (n as number) <= this.o.slideCount;
  private context(n: number) {
    const f = this.plan?.flow.find((x) => x.slide === n);
    return { heading: f?.does ?? "", text: f?.pupils_see ?? "" };
  }
  submittedCount = () => [...this.slides.values()].filter((s) => s.submitted).length;

  async call(name: string, a: any): Promise<unknown> {
    if (name !== "set_plan" && !this.plan) return { ok: false, error: "call set_plan first" };
    if (name !== "finish" && name !== "set_plan" && !this.valid(a?.slide))
      return { ok: false, error: `slide must be 1..${this.o.slideCount}` };
    switch (name) {
      case "set_plan":
        return this.setPlan(a);
      case "find_picture":
        return this.findPicture(a);
      case "draw_diagram":
        return this.drawDiagram(a);
      case "render_slide":
        return this.render(a);
      case "probe_slide":
        return this.probeSlide(a);
      case "submit_slide":
        return this.submit(a);
      case "finish":
        return this.finish();
      default:
        return { ok: false, error: `unknown tool ${name}` };
    }
  }

  private setPlan(a: Plan) {
    if (this.plan) return { ok: false, error: "the plan is already set" };
    const flow = Array.isArray(a?.flow) ? a.flow : [];
    if (!a?.title || !Array.isArray(a.objectives) || !a.objectives.length)
      return { ok: false, error: "title and at least one objective pair are required" };
    if (flow.length < this.o.slideMin || flow.length > this.o.slideMax)
      return {
        ok: false,
        error: `flow has ${flow.length} slides; the brief asks for ${this.o.slideMin === this.o.slideMax ? this.o.slideMin : `${this.o.slideMin} to ${this.o.slideMax}`}`,
      };
    const nums = flow.map((f) => f.slide).sort((x, y) => x - y);
    if (nums.some((v, i) => v !== i + 1))
      return { ok: false, error: `flow must be numbered 1..${flow.length}` };
    this.o.slideCount = flow.length;
    this.plan = a;
    this.timings.title = this.ms();
    return { ok: true, slides: this.o.slideCount, turns_left: this.turnsLeft };
  }

  private visual() {
    this.timings.last_visual = this.ms();
  }

  private async findPicture(a: any) {
    if (!a.request || !["named", "generic"].includes(a.kind))
      return { ok: false, error: "request and kind (named | generic) are required" };
    const st = this.slide(a.slide);
    const id = `p${a.slide}${String.fromCharCode(97 + st.pictures.length)}`;
    st.pictures.push(id);
    const ask = {
      slide: a.slide,
      request: String(a.request),
      kind: a.kind,
      ...(a.period ? { period: String(a.period) } : {}),
      ...(a.aspect > 0 ? { aspect: Number(a.aspect) } : {}),
    };
    const r = await this.o.findPicture(ask, id, this.context(a.slide));
    this.pictures[id] = { ask, result: r };
    this.visual();
    return r;
  }

  private async drawDiagram(a: any) {
    const st = this.slide(a.slide);
    const id = `d${a.slide}${String.fromCharCode(97 + st.diagrams.length)}`;
    st.diagrams.push(id);
    const ask = {
      slide: a.slide,
      kind: String(a.kind),
      request: String(a.request ?? ""),
      width: Number(a.width),
      height: Number(a.height),
    };
    const c = this.context(a.slide);
    const r = await this.o.drawDiagram(ask, id, `${c.heading}\n${c.text}`);
    this.diagrams[id] = { ask, result: r };
    if (r.ok) this.visual();
    return r;
  }

  private async render(a: any) {
    const st = this.slide(a.slide);
    if (typeof a.html !== "string" || !a.html.trim())
      return { ok: false, error: "html is required" };
    if (st.renders.length >= MAX_RENDERS)
      return {
        ok: false,
        error: `slide ${a.slide} has had its ${MAX_RENDERS} renders (first + 2 repairs); submit it or leave it`,
      };
    const n = st.renders.length + 1;
    const file = join(
      this.o.runDir,
      "work",
      `slide-${String(a.slide).padStart(2, "0")}-r${n}.html`,
    );
    writeFileSync(
      file,
      wrap(a.html, this.o.tk, this.o.runDir).replace(
        "<head>",
        `<head><base href="file://${this.o.runDir}/">`,
      ),
    );
    const geometry = await this.o.renderer.measure(file, this.o.tk.minFont);
    st.renders.push({ n, html: a.html, file, geometry });
    const first = st.renders[0].geometry.total;
    const prev = n > 1 ? st.renders[n - 2].geometry.total : geometry.total;
    return {
      ok: true,
      slide: a.slide,
      render: n,
      renders_left: MAX_RENDERS - n,
      total: geometry.total,
      first_total: first,
      change: geometry.total - prev,
      counts: geometry.counts,
      violations: geometry.violations,
      boxes: geometry.boxes,
      submittable: geometry.total <= first,
    };
  }

  private async probeSlide(a: any) {
    const st = this.slide(a.slide);
    const last = st.renders.at(-1);
    if (!last) return { ok: false, error: `render slide ${a.slide} first` };
    if (last.probe)
      return { ok: false, error: `already probed render ${last.n} of slide ${a.slide}` };
    const ids: string[] = Array.isArray(a.questions) ? [...new Set<string>(a.questions)] : [];
    if (
      !ids.length ||
      ids.length > 5 ||
      ids.some((i) => !(PROBE_IDS as readonly string[]).includes(i))
    )
      return { ok: false, error: `questions: 1 to 5 of ${PROBE_IDS.join(", ")}` };
    const png = last.file.replace(/\.html$/, ".png");
    await this.o.renderer.png(last.file, png);
    last.probe = await this.o.probe(png, ids);
    return { ok: true, slide: a.slide, render: last.n, answers: last.probe };
  }

  private submit(a: any) {
    const st = this.slide(a.slide);
    const last = st.renders.at(-1);
    if (!last) return { ok: false, error: `render slide ${a.slide} first` };
    const first = st.renders[0].geometry.total;
    if (last.geometry.total > first)
      return {
        ok: false,
        error: `render ${last.n} has ${last.geometry.total} violations, first render had ${first}: fix it${last.n < MAX_RENDERS ? " and render again" : "; no renders left, so it cannot be submitted"}`,
      };
    st.submitted = { render: last.n, notes: String(a.notes ?? ""), at: this.ms() };
    if (a.slide >= 2 && this.timings.first_teaching_slide === null)
      this.timings.first_teaching_slide = this.ms();
    if (this.submittedCount() === this.o.slideCount) this.timings.editable = this.ms();
    return {
      ok: true,
      slide: a.slide,
      submitted: this.submittedCount(),
      of: this.o.slideCount,
      turns_left: this.turnsLeft,
    };
  }

  private finish() {
    this.finishCalls++;
    const missing = Array.from({ length: this.o.slideCount }, (_, i) => i + 1).filter(
      (n) => !this.slides.get(n)?.submitted,
    );
    if (!missing.length || this.finishCalls >= 2) {
      this.done = true;
      return { ok: !missing.length, missing };
    }
    return { ok: false, missing };
  }

  /** At the turn cap or end: submit each unsubmitted slide whose last render passes the gate. */
  autoSubmit(): number[] {
    const auto: number[] = [];
    for (const [n, st] of this.slides) {
      const last = st.renders.at(-1);
      if (st.submitted || !last || last.geometry.total > st.renders[0].geometry.total) continue;
      st.submitted = { render: last.n, notes: "", at: this.ms() };
      auto.push(n);
    }
    if (this.timings.editable === null) this.timings.editable = this.ms();
    return auto;
  }

  /** Every slide's record for lesson.json; writes the submitted HTML and the 1440 PNGs. */
  async output() {
    const out = [];
    for (let n = 1; n <= this.o.slideCount; n++) {
      const st = this.slides.get(n);
      const sub = st?.submitted;
      const r = sub ? st!.renders[sub.render - 1] : undefined;
      const nn = String(n).padStart(2, "0");
      if (r) {
        const html = wrap(r.html, this.o.tk, this.o.runDir).replace(/assets\//g, "../assets/");
        writeFileSync(join(this.o.runDir, "html", `slide-${nn}.html`), html);
        await this.o.renderer.png(r.file, join(this.o.runDir, "render", `slide-${nn}.png`));
      }
      out.push({
        slide: n,
        flow: this.plan?.flow.find((f) => f.slide === n) ?? null,
        status: r ? "submitted" : "missing",
        html: r?.html ?? null,
        notes: sub?.notes ?? "",
        submittedAtMs: sub?.at ?? null,
        renders: st?.renders.length ?? 0,
        violationsFirst: st?.renders[0]?.geometry ?? null,
        violationsFinal: r?.geometry ?? null,
        probes: (st?.renders ?? []).map((x) => ({ render: x.n, answers: x.probe ?? null })),
        pictures: st?.pictures ?? [],
        diagrams: st?.diagrams ?? [],
        png: r ? `render/slide-${nn}.png` : null,
      });
    }
    return out;
  }
  nextSeq = () => ++this.seq;
}
