import type { Lesson, Slide } from "@tj/domain/documents";
import type { JobEvent } from "@tj/domain/jobs";
import { useEffect, useMemo, useState } from "react";
import { GeneratingShell } from "@/components/generating-lesson/GeneratingShell";
import { latestLive } from "@/components/generating-lesson/live-writing";

const PLACEHOLDER =
  "data:image/svg+xml;utf8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='844' height='1080'%3E%3Crect width='844' height='1080' fill='%23E9E8E3'/%3E%3C/svg%3E";

type Fixture = { lesson: Lesson; events: { t: number; event: JobEvent }[] };

/** When each slide was saved: the k-th "Slide k of N" save goes to the k-th slide the stream closed. */
function saveTimes(fx: Fixture): Map<number, number> {
  const lastLive = new Map<number, number>();
  for (const { t, event } of fx.events) {
    if (event.type === "progress" && event.progress.live)
      lastLive.set(event.progress.live.index, t);
  }
  const order = [...lastLive.entries()].sort((a, b) => a[1] - b[1]).map(([i]) => i);
  const saved = new Map<number, number>([
    [0, 0],
    [1, 0],
  ]);
  let count = 2;
  for (const { t, event } of fx.events) {
    const m =
      event.type === "progress" ? /^Slide (\d+) of/.exec(event.progress.message ?? "") : null;
    const k = m ? Number(m[1]) : 0;
    while (count < k && order.length > 0) {
      const next = order.shift() as number;
      if (!saved.has(next)) saved.set(next, t);
      count += 1;
    }
    if (
      event.type === "completed" ||
      (event.type === "progress" && event.progress.message === "Slides ready")
    ) {
      fx.lesson.slides.forEach((_, i) => {
        if (!saved.has(i)) saved.set(i, t);
      });
    }
  }
  return saved;
}

export function DevLiveReplayPage() {
  const params = new URLSearchParams(window.location.search);
  const name = params.get("fixture") ?? "particle-sol";
  const speed = Number(params.get("speed") ?? "1") || 1;
  const [fx, setFx] = useState<Fixture | null>(null);
  const [t, setT] = useState(0);
  useEffect(() => {
    void fetch(`/live-replay/${name}.json`)
      .then((r) => r.json())
      .then((data: Fixture) => setFx(data));
  }, [name]);
  useEffect(() => {
    if (!fx) return;
    const start = performance.now();
    const end = (fx.events.at(-1)?.t ?? 0) + 2000;
    let frame = 0;
    const tick = (now: number) => {
      const at = (now - start) * speed;
      setT(at);
      if (at < end) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [fx, speed]);
  const saves = useMemo(() => (fx ? saveTimes(fx) : new Map<number, number>()), [fx]);
  const events = useMemo(
    () => (fx ? fx.events.filter((e) => e.t <= t).map((e) => e.event) : []),
    [fx, t],
  );
  const live = useMemo(() => latestLive(events), [events]);
  if (!fx) return null;
  const savedNow = [...saves.entries()].filter(([, at]) => at <= t).map(([i]) => i);
  const top = Math.max(-1, ...savedNow);
  // Photos arrive when the run placed them, as placeholders until then.
  const photoAt =
    fx.events.find(
      (e) => e.event.type === "progress" && e.event.progress.message === "Photo placed",
    )?.t ?? 0;
  const noPhoto = (s: Slide): Slide =>
    t >= photoAt
      ? s
      : ({
          ...s,
          elements: s.elements.map((e) =>
            e.type === "image" && e.src.startsWith("data:image/jpeg")
              ? { ...e, src: PLACEHOLDER }
              : e,
          ),
        } as Slide);
  const slides: Slide[] = Array.from({ length: top + 1 }, (_, i) => {
    const final = noPhoto(fx.lesson.slides[i] as Slide);
    if (savedNow.includes(i)) return final;
    return { ...(live.get(i)?.slide ?? final), id: `pending-${i + 1}` };
  });
  return (
    <GeneratingShell
      lesson={{ ...fx.lesson, slides }}
      events={events}
      live={live}
      onBack={() => {}}
      onStop={() => {}}
      onEditSlide={() => {}}
    />
  );
}
