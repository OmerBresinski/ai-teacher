// Arm C: the model side. Real: OpenAI Responses API with function tools (previous_response_id chaining).
// Stub: a scripted agent that reads the tool results (no network) to prove the loop and tools.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";

export interface Call {
  call_id: string;
  name: string;
  arguments: string;
}
export interface Turn {
  calls: Call[];
  text: string;
  usage: { input: number; cached: number; output: number; reasoning: number };
  usd: number;
  ms: number;
  id?: string;
}
export interface Model {
  next(results: { call_id: string; output: string }[]): Promise<Turn>;
}

const SOL = { in: 2, cached: 0.1, out: 10 }; // openai/gpt-6.1-sol per MTok (packages/ai/src/prices.ts)

export function responsesModel(o: {
  model: string;
  effort: string;
  instructions: string;
  user: string;
  tools: unknown[];
}): Model {
  const KEY = readFileSync(`${homedir()}/.dayback-openai-key`, "utf8").trim();
  let prev: string | undefined;
  return {
    async next(results) {
      const input = prev
        ? results.map((r) => ({
            type: "function_call_output",
            call_id: r.call_id,
            output: r.output,
          }))
        : [{ role: "user", content: o.user }];
      const t0 = performance.now();
      const res = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: o.model,
          instructions: o.instructions,
          input,
          tools: o.tools,
          parallel_tool_calls: true,
          reasoning: { effort: o.effort },
          ...(prev ? { previous_response_id: prev } : {}),
        }),
      });
      const j: any = await res.json();
      if (!res.ok) throw new Error(`responses ${res.status}: ${JSON.stringify(j).slice(0, 400)}`);
      prev = j.id;
      const u = j.usage ?? {};
      const cached = u.input_tokens_details?.cached_tokens ?? 0;
      const usage = {
        input: u.input_tokens ?? 0,
        cached,
        output: u.output_tokens ?? 0,
        reasoning: u.output_tokens_details?.reasoning_tokens ?? 0,
      };
      const usd =
        ((usage.input - cached) * SOL.in + cached * SOL.cached + usage.output * SOL.out) / 1e6;
      const calls = (j.output ?? [])
        .filter((x: any) => x.type === "function_call")
        .map((x: any) => ({ call_id: x.call_id, name: x.name, arguments: x.arguments }));
      const text = (j.output ?? [])
        .filter((x: any) => x.type === "message")
        .flatMap((x: any) => x.content.map((c: any) => c.text ?? ""))
        .join("\n");
      return { calls, text, usage, usd, ms: Math.round(performance.now() - t0), id: j.id };
    },
  };
}

/**
 * The stub agent. Slides: 1 title; 2 objectives; 3 picture + probe; 4 diagram, first render
 * overflows, repaired from the numbers; 5 tries a worse repair (gate refuses), then fixes; 6 asks
 * for a 4th render (refused); the rest plain. Every decision reads the previous tool result.
 */
export function stubModel(slideCount: number, title: string): Model {
  let id = 0;
  const mk = (name: string, args: unknown): Call => ({
    call_id: `c${++id}`,
    name,
    arguments: JSON.stringify(args),
  });
  const last = new Map<string, any>(); // call_id -> parsed result
  const byName = new Map<string, any[]>();
  let step = 0;
  const pic: Record<number, string> = {};
  const dia: Record<number, string> = {};
  const plain = (n: number, heading: string, body: string) =>
    `<h1 id="h${n}" style="position:absolute;left:120px;top:90px;width:1680px;margin:0;font-family:var(--font-title);font-weight:var(--fw-heading);font-size:var(--fs-heading);line-height:var(--lh-heading);color:var(--heading)">${heading}</h1><p id="b${n}" style="position:absolute;left:120px;top:300px;width:1680px;margin:0">${body}</p>`;
  const script: ((r: any[]) => Call[])[] = [
    // refusals first: a tool before the plan, and a plan with the wrong slide count
    () => [
      mk("find_picture", { slide: 3, request: "a cow", kind: "generic" }),
      mk("set_plan", {
        title,
        objectives: [{ teacher: "x", pupil: "y" }],
        flow: [{ slide: 1, does: "title", pupils_see: "none" }],
      }),
    ],
    () => [
      mk("set_plan", {
        title,
        objectives: [
          {
            teacher: "Pupils can name adult animals and their young.",
            pupil: "I can match a baby animal to its parent.",
          },
        ],
        flow: Array.from({ length: slideCount }, (_, i) => ({
          slide: i + 1,
          does: i === 0 ? "title" : `teaches step ${i}`,
          pupils_see: i === 2 ? "a photo of a cow and calf" : i === 3 ? "a cycle diagram" : "none",
        })),
      }),
    ],
    () => [
      mk("find_picture", {
        slide: 3,
        request: "a cow with her calf in a field",
        kind: "generic",
        aspect: 1.4,
      }),
      mk("draw_diagram", {
        slide: 4,
        kind: "cycle",
        request: "life cycle of a frog",
        width: 900,
        height: 700,
      }),
      mk("find_picture", {
        slide: 9,
        request: "Germany 1923 hyperinflation banknotes",
        kind: "named",
        period: "Germany, 1923",
      }),
    ],
    (r) => {
      for (const x of r) {
        if (x.picture_id) pic[x.picture_id.startsWith("p3") ? 3 : 9] = x.src;
        if (x.diagram_id) dia[4] = x.src;
      }
      return [
        mk("render_slide", {
          slide: 1,
          html: `<div data-layer="back" style="position:absolute;inset:0;background:var(--accent)"></div><h1 id="title" style="position:absolute;left:160px;top:380px;width:1600px;margin:0;font-family:var(--font-title);font-size:var(--fs-title);line-height:var(--lh-title);color:var(--on-accent)">${title}</h1>`,
        }),
        mk("render_slide", {
          slide: 2,
          html: plain(2, "Today we will", "I can match a baby animal to its parent."),
        }),
        mk("render_slide", {
          slide: 3,
          html: `<h1 id="h3" style="position:absolute;left:120px;top:90px;margin:0;font-size:var(--fs-heading)">Who is this?</h1><img id="pic3" src="${pic[3]}" style="position:absolute;left:120px;top:260px;width:980px;height:700px;object-fit:cover;border-radius:var(--radius)"><p id="t3" style="position:absolute;left:1160px;top:300px;width:640px;margin:0">A calf is a baby cow.</p>`,
        }),
        // slide 4: a fixed-height box that is too short: overflow on purpose
        mk("render_slide", {
          slide: 4,
          html: `<h1 id="h4" style="position:absolute;left:120px;top:90px;margin:0;font-size:var(--fs-heading)">A frog grows up</h1><img id="dia4" src="${dia[4]}" style="position:absolute;left:120px;top:260px;width:900px;height:700px"><div id="steps" style="position:absolute;left:1100px;top:260px;width:700px;height:200px"><p style="margin:0">Frogspawn hatches into tadpoles. Tadpoles grow legs. Then they lose their tails and become frogs.</p></div>`,
        }),
        mk("render_slide", {
          slide: 5,
          html: `${plain(5, "Watch out", "Short text")}<div id="box5" style="position:absolute;left:120px;top:500px;width:400px;height:300px;background:var(--surface)"></div><div id="box5b" style="position:absolute;left:400px;top:600px;width:400px;height:300px;background:var(--line)"></div>`,
        }),
        mk("render_slide", {
          slide: 6,
          html: `<p id="tiny" style="position:absolute;left:120px;top:120px;font-size:12px">too small</p>`,
        }),
      ];
    },
    (r) => {
      const s4 = r.find((x) => x.slide === 4);
      const over = s4?.violations?.find((v: any) => v.type === "overflow");
      const need = 200 + (over?.px ?? 0) + 20; // repair from the numbers
      return [
        mk("probe_slide", {
          slide: 3,
          questions: ["picture_matches_text", "one_focal_point", "not_too_blank"],
        }),
        mk("render_slide", {
          slide: 4,
          html: `<h1 id="h4" style="position:absolute;left:120px;top:90px;margin:0;font-size:var(--fs-heading)">A frog grows up</h1><img id="dia4" src="${dia[4]}" style="position:absolute;left:120px;top:260px;width:900px;height:700px"><div id="steps" style="position:absolute;left:1100px;top:260px;width:700px;height:${need}px"><p style="margin:0">Frogspawn hatches into tadpoles. Tadpoles grow legs. Then they lose their tails and become frogs.</p></div>`,
        }),
        // slide 5: a worse repair (adds an off-canvas element)
        mk("render_slide", {
          slide: 5,
          html: `${plain(5, "Watch out", "Short text")}<div id="box5" style="position:absolute;left:120px;top:500px;width:400px;height:300px;background:var(--surface)"></div><div id="box5b" style="position:absolute;left:400px;top:600px;width:400px;height:300px;background:var(--line)"></div><p id="lost" style="position:absolute;left:1800px;top:900px;width:400px">off the edge</p>`,
        }),
        mk("submit_slide", { slide: 1, notes: "Welcome." }),
        mk("submit_slide", { slide: 2, notes: "Read the objective." }),
        mk("render_slide", {
          slide: 6,
          html: `<p id="tiny" style="position:absolute;left:120px;top:120px;font-size:13px">still too small</p>`,
        }),
      ];
    },
    () => [
      mk("submit_slide", { slide: 3, notes: "Ask: who is the calf's mother?" }),
      mk("submit_slide", { slide: 4 }),
      mk("submit_slide", { slide: 5 }), // refused by the gate
      mk("render_slide", {
        slide: 6,
        html: `<p id="tiny" style="position:absolute;left:120px;top:120px;font-size:14px">third</p>`,
      }),
    ],
    () => [
      mk("render_slide", {
        slide: 5,
        html:
          plain(5, "Watch out", "Fixed: one panel only.") +
          `<div id="box5" style="position:absolute;left:120px;top:500px;width:400px;height:300px;background:var(--surface)"></div>`,
      }),
      mk("render_slide", { slide: 6, html: `<p>fourth</p>` }), // refused: 4th render
      ...Array.from({ length: Math.max(0, slideCount - 6) }, (_, i) =>
        mk("render_slide", {
          slide: 7 + i,
          html: plain(
            7 + i,
            `Slide ${7 + i}`,
            i === 2 && pic[9]
              ? `<img id="pic9" src="${pic[9]}" style="width:600px;height:400px">`
              : "Plain teaching text that fits.",
          ),
        }),
      ),
    ],
    () => [
      mk("submit_slide", { slide: 5 }),
      mk("submit_slide", { slide: 6 }),
      ...Array.from({ length: Math.max(0, slideCount - 6) }, (_, i) =>
        mk("submit_slide", { slide: 7 + i }),
      ),
    ],
    () => [mk("finish", {})],
  ];
  return {
    async next(results) {
      const parsed = results.map((r) => {
        const v = JSON.parse(r.output);
        last.set(r.call_id, v);
        return v;
      });
      const f = script[step++];
      const calls = f ? f(parsed) : [mk("finish", {})];
      for (const c of calls) byName.set(c.name, [...(byName.get(c.name) ?? []), c]);
      return {
        calls,
        text: "",
        usage: { input: 0, cached: 0, output: 0, reasoning: 0 },
        usd: 0,
        ms: 1,
      };
    },
  };
}
