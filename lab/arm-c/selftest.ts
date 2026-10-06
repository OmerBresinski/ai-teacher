// Arm C geometry self-test: fixtures with known violation counts, rendered in the real wrapper.
// Usage: bun lab/arm-c/selftest.ts <scratch dir>
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { wrap } from "./page.ts";
import { Renderer } from "./renderer.ts";
import { tokensFor } from "./tokens.ts";

const dir = process.argv[2]!;
mkdirSync(join(dir, "assets"), { recursive: true });
writeFileSync(
  join(dir, "assets", "p1.svg"),
  `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="500"><rect width="800" height="500" fill="#9ab"/></svg>`,
);
const H = `font-family:var(--font-title);font-size:var(--fs-heading);line-height:var(--lh-heading);color:var(--heading);margin:0`;
const good = `<div style="display:grid;grid-template-columns:1fr 1fr;gap:64px;padding:96px 120px;height:100%">
 <div style="display:flex;flex-direction:column;gap:40px"><h2 id="h" style="${H}">Where do baby animals come from?</h2>
  <ul id="pts" style="margin:0;padding-left:48px"><li>A calf is a baby cow.</li><li>A lamb is a baby sheep.</li><li>A chick hatches from an egg.</li></ul>
  <div id="call" style="background:var(--key-words-fill);border:3px solid var(--key-words-line);border-radius:var(--radius);padding:32px"><b>young</b>: a baby animal</div></div>
 <img id="pic" src="assets/p1.svg" style="width:100%;height:760px;object-fit:cover;border-radius:var(--radius)"></div>`;
const cases: [string, string, Record<string, number>][] = [
  ["good grid slide", good, {}],
  [
    "full-bleed photo backdrop with text on it",
    `<img data-layer="back" src="assets/p1.svg" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover"><h1 id="t" style="position:absolute;left:120px;bottom:120px;${H}">On top</h1>`,
    {},
  ],
  [
    "caption over photo (not a backdrop)",
    `<img id="ph" src="assets/p1.svg" style="position:absolute;left:100px;top:100px;width:800px;height:500px"><p id="cap" style="position:absolute;left:150px;top:500px;margin:0">caption</p>`,
    { overlap: 1 },
  ],
  [
    "overflow hidden clips text",
    `<div id="box" style="position:absolute;left:100px;top:100px;width:600px;height:120px;overflow:hidden"><p id="long" style="margin:0">One two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen</p></div>`,
    { clipping: 1 },
  ],
  [
    "ellipsis",
    `<p id="el" style="position:absolute;left:100px;top:100px;width:300px;margin:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">A very long line that will not fit at all</p>`,
    { clipping: 1 },
  ],
  [
    "off canvas + external image",
    `<p id="far" style="position:absolute;left:1700px;top:100px;width:600px;margin:0">off to the right edge</p><img id="ext" src="https://example.com/x.png" style="position:absolute;left:0;top:600px;width:200px;height:100px">`,
    { off_canvas: 1, broken_image: 1 },
  ],
  [
    "svg label cut at the diagram's edge",
    `<div id="dg" data-diagram="x" style="position:absolute;left:200px;top:200px;width:600px;height:400px"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 200" width="100%" height="100%"><text x="-20" y="100" font-size="24">sheep</text><text x="150" y="150" font-size="24">fine</text></svg></div>`,
    { clipping: 1 },
  ],
  [
    "svg labels inside",
    `<div id="dg2" data-diagram="x" style="position:absolute;left:200px;top:200px;width:600px;height:400px"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 200" width="100%" height="100%"><text x="10" y="30" font-size="24">Title at the top</text><text x="150" y="190" font-size="24">base</text></svg></div>`,
    {},
  ],
  [
    "fixed-height box text spill",
    `<div id="card" style="position:absolute;left:100px;top:100px;width:500px;height:100px;background:var(--surface)"><p id="t2" style="margin:0">Line one of text that wraps onto line two and three and four</p></div>`,
    { overflow: 1 },
  ],
];
const r = new Renderer();
await r.start();
let fail = 0;
for (const ks of ["Year 1", "Year 9"]) {
  const tk = tokensFor(ks);
  for (const [i, [name, html, want]] of cases.entries()) {
    const f = join(dir, `case-${ks.replace(" ", "")}-${i}.html`);
    writeFileSync(f, wrap(html, tk, dir).replace("<head>", `<head><base href="file://${dir}/">`));
    const g = await r.measure(f, tk.minFont);
    const got = Object.fromEntries(Object.entries(g.counts).filter(([, v]) => v));
    const ok =
      JSON.stringify(Object.entries(got).sort()) === JSON.stringify(Object.entries(want).sort());
    if (!ok) fail++;
    console.log(
      `${ok ? "PASS" : "FAIL"} ${ks} ${name}: ${JSON.stringify(got)}${ok ? "" : ` want ${JSON.stringify(want)} :: ${JSON.stringify(g.violations.map((v) => [v.type, v.element, v.other, v.px]))}`}`,
    );
  }
  if (ks === "Year 1") await r.png(join(dir, `case-Year1-0.html`), join(dir, "good.png"));
}
await r.stop();
console.log(fail ? `${fail} FAILED` : "ALL PASS");
process.exit(fail ? 1 : 0);
