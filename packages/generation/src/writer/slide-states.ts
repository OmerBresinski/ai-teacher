/**
 * A slide's code-decided visual states (the stage's `override` and `drawnDiagrams` maps, keyed
 * `<slide>:<key>`), saved when the slide is swapped out and put back when it is restored, so a state
 * set for a rewrite that was undone (orphan6's dropped picture, a lostPic attempt) never outlives
 * it (#423 review). Saved per slide object; the first save for an object wins.
 */
export function slideStates<V>(maps: Map<string, V>[]) {
  const before = new WeakMap<object, [string, V][][]>();
  const ofSlide = (i: number, m: Map<string, V>) => [...m].filter(([k]) => k.startsWith(`${i}:`));
  return {
    save(i: number, slide: unknown) {
      if (slide && typeof slide === "object" && !before.has(slide))
        before.set(
          slide,
          maps.map((m) => ofSlide(i, m)),
        );
    },
    put(i: number, slide: unknown) {
      const was = slide && typeof slide === "object" ? before.get(slide) : undefined;
      if (!was) return;
      maps.forEach((m, n) => {
        for (const [k] of ofSlide(i, m)) m.delete(k);
        for (const [k, v] of was[n] ?? []) m.set(k, v);
      });
    },
  };
}
