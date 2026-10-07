// A/B a3 drawer check (coordinator, 7 Oct): bun lab/bakeoff/ab/drawer-a3.ts <set.json> <out.json> --yes
// PAID (~$0.0004 a request). Each request goes through a3's drawer (meaning drawer for flow,
// equal-groups and fraction-shapes). Pass: every request within its slot's cap draws; every request
// over the cap is drawn across the slide or routed to restage before any call. Every attempt's fault is kept.
import { readFileSync, writeFileSync } from "node:fs";
import { slotLimit } from "../../../packages/slides/src/diagrams/limits";
import { type DiagramAsk, diagramSpec, Ledger } from "../services";
import { setAbArm } from "./arms";

if (!process.argv.includes("--yes")) throw new Error("paid: pass --yes");
setAbArm("a3");
type Case = { id: string; ask: DiagramAsk };
const set = JSON.parse(readFileSync(process.argv[2] as string, "utf8")) as Case[];
const ledger = new Ledger(0.03);
const within = (a: DiagramAsk) => {
  const l = slotLimit(a.kind, a.stage ?? "ks3", a.slot?.name ?? "side");
  return (
    !l ||
    (a.labels.length <= l.items &&
      (!l.chars || a.labels.every((x) => x.length <= (l.chars as number))))
  );
};
const rows = await Promise.all(
  set.map(async (c) => {
    const ev: Record<string, unknown>[] = [];
    const out = await diagramSpec(c.ask, ledger, (e) => ev.push(e as Record<string, unknown>));
    const cap = ev.find((e) => e.ev === "diagram-over-cap");
    const inCap = within(c.ask);
    const outcome = out
      ? cap
        ? "drew-full"
        : "drew"
      : cap?.to === "restage"
        ? "restage"
        : "no-spec";
    const ok = inCap ? outcome === "drew" : outcome !== "no-spec";
    return {
      id: c.id,
      kind: c.ask.kind,
      inCap,
      outcome,
      ok,
      faults: ev.filter((e) => e.fault).map((e) => e.fault),
    };
  }),
);
const usd = Object.values(ledger.parts).reduce((a, b) => a + b, 0);
const res = { usd, pass: rows.every((r) => r.ok), rows };
writeFileSync(process.argv[3] as string, JSON.stringify(res, null, 1));
for (const r of rows)
  console.log(
    r.ok ? "ok  " : "FAIL",
    r.id,
    r.inCap ? "in-cap" : "over-cap",
    r.outcome,
    r.faults.join(" | ").slice(0, 200),
  );
console.log(`pass ${res.pass}, $${usd.toFixed(4)}`);
