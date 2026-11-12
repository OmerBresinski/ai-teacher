import { iconFits, resolveIcon } from "@tj/slides/icons";

/*
 * TEACH-247 part ci: icons for names the catalogue lacks. A panel list's or stages strip's visual
 * is a row of catalogue icons, a hinge's options may be icon tiles and a myth's proof a line with
 * icons. The writer can only name an icon from the closed `layout-icon` list, so an item that
 * names something the list lacks (hydraulic action, abrasion, respiration, cut-off) came back
 * null and the slide shipped as words. Code routes each such slot to a real visual instead, in
 * this order, and never to a vaguely related icon (a wrong icon is worse than none):
 *
 * 1. the catalogue icon the item's own words name exactly (`resolveIcon` on its name, which
 *    matches only a label or synonym, and `iconFits` on its words): the writer left out an icon
 *    the list has;
 * 2. the item's own `picture` field, asked of the picture pipeline in the lesson's look (stock,
 *    then generated in its picture style): a panel list's rows and a stages strip's stages take
 *    one picture each, all or none (pictures win over icons in both layouts), and a myth's proof
 *    takes one picture of its line;
 * 3. no honest visual (a hinge has no picture tile, a panel list whose title panel already holds a
 *    picture keeps it): the misses are returned as a fault (`icon-miss`), never dropped in silence.
 *
 * The layout is never changed: every route fills a slot the writer's schema already has.
 */
type S = Record<string, unknown>;
type Pic = { shows: string; must_see: string[]; subject: "generic" };

/** One slot the catalogue had no icon for, and where it went. */
export type IconMiss = { slot: string; name: string };
export type IconRoute = {
  /** catalogue: icons the item names; picture: the item's own picture; none: a fault. */
  to: "catalogue" | "picture" | "none";
  misses: IconMiss[];
  /** Why no honest visual could be made (route none). */
  why?: string;
};

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const isPic = (v: unknown) => !!v && typeof v === "object" && !!str((v as S).shows);
/** A draft's pending icon or the editor's blank is not an icon. */
const hasIcon = (v: unknown) => !!str(v) && !/^\(icon pending\)$|^placeholder$/i.test(str(v));
const article = (s: string) => s.replace(/^(a|an|the)\s+/i, "");

/** The catalogue id an item's own name names exactly, when its words fit it; else null. */
export function iconNamed(name: string, own: string, around: string, subject?: string) {
  const ctx = { subject };
  const id = resolveIcon(article(name.replace(/[.!?]+$/, "")), ctx);
  return id && iconFits(id, own, around, ctx) ? id : null;
}

/**
 * A picture of one item, asked in the lesson's look: the thing alone, its line as context, and the
 * slide's heading after it. Without the heading the ask names no context at all: y8 photosynthesis
 * s8 asked "Respiration: Glucose is used in respiration to release energy" on "How plants use
 * glucose" and was painted as a girl eating an apple (11 Nov blind review, CRITIQUE-1 item 2).
 */
const pictureOf = (name: string, line: string, heading = ""): Pic => {
  const thing = line ? `${name}: ${line.replace(/[.!?]+$/, "")}` : name.replace(/[.!?]+$/, "");
  const on = heading.replace(/[.!?]+$/, "").trim();
  return {
    shows: on && !thing.toLowerCase().includes(on.toLowerCase()) ? `${thing} (${on})` : thing,
    must_see: [name],
    subject: "generic",
  };
};

/**
 * A row (panel-list rows, stages) whose icons the catalogue could not all give: fill the missing
 * ones from the catalogue when every item names one, else give every item its own picture.
 */
function routeRow(
  s: S,
  slot: string,
  textKey: "text" | "line",
  around: string,
  subject: string | undefined,
  panelHolds: boolean,
  fits: (x: S) => boolean,
): { slide: S; route?: IconRoute } {
  const items = (Array.isArray(s.items) ? s.items : []) as (S | null)[];
  if (!items.length || items.some((i) => !i || isPic(i.picture))) return { slide: s };
  const resolved = items.map((i) =>
    hasIcon(i?.icon) && resolveIcon(str(i?.icon), { subject }) ? str(i?.icon) : null,
  );
  if (resolved.every(Boolean)) return { slide: s };
  const misses = items.flatMap((i, n) =>
    resolved[n] ? [] : [{ slot: `${slot}.${n}`, name: str(i?.name) }],
  );
  const named = items.map(
    (i, n) =>
      resolved[n] ??
      iconNamed(str(i?.name), `${str(i?.name)}\n${str(i?.[textKey])}`, around, subject),
  );
  if (named.every(Boolean))
    return {
      slide: { ...s, items: items.map((i, n) => ({ ...i, icon: named[n] })) },
      route: { to: "catalogue", misses },
    };
  // The title panel already holds a picture: row pictures would take its place (all or none,
  // pictures win), so the panel stays and the rows' misses are reported.
  if (panelHolds) return { slide: s, route: { to: "none", misses, why: "panel-picture" } };
  const pictured = {
    ...s,
    items: items.map((i) => ({
      ...i,
      icon: null,
      picture: pictureOf(str(i?.name), str(i?.[textKey]), str(s.heading)),
    })),
  };
  // A picture row has less room for each line: pictures that would cut the writer's words are
  // not routed (a cut word is a loss too), and the misses are reported.
  if (!fits(pictured)) return { slide: s, route: { to: "none", misses, why: "pictures-over" } };
  return { slide: pictured, route: { to: "picture", misses } };
}

/**
 * Routes the slide's catalogue misses (see the module note). `around` is the lesson's words the
 * icon is judged by (the slide and the topic), `subject` the brief's subject (a scoped term such as
 * "roots" needs it), `fits` whether a slide still fits its layout (the stage measures it at the
 * drawn size; absent, everything fits). Returns the slide unchanged and no route when nothing was
 * missing.
 */
export function routeIconMisses(
  s: S,
  opts: { around?: string; subject?: string; fits?: (x: S) => boolean } = {},
): { slide: S; route?: IconRoute } {
  const around = `${str(s.heading)}\n${opts.around ?? ""}`;
  const subject = opts.subject;
  const fits = opts.fits ?? (() => true);
  switch (str(s.template)) {
    case "panel-list": {
      const pn = (s.panel ?? null) as S | null;
      return routeRow(s, "row", "text", around, subject, !!pn && isPic(pn.picture), fits);
    }
    case "stages":
      return routeRow(s, "stage", "line", around, subject, false, fits);
    case "myth": {
      const nested = !!s.myth && typeof s.myth === "object";
      const m = (nested ? s.myth : s) as S;
      const p = (m.proof && typeof m.proof === "object" ? m.proof : null) as S | null;
      const line = str(p?.line);
      if (!p || !line || isPic(p.picture)) return { slide: s };
      // Met only when every listed icon is one the catalogue draws (["leaf", null] is not).
      const icons = Array.isArray(p.icons) ? (p.icons as unknown[]) : [];
      if (icons.length && icons.every((i) => hasIcon(i) && resolveIcon(str(i), { subject })))
        return { slide: s };
      const proof = { ...p, icons: null, picture: pictureOf(line, "", str(s.heading)) };
      const m2 = { ...m, proof };
      const slide = nested ? { ...s, myth: m2 } : m2;
      const misses = [{ slot: "proof", name: line }];
      // The fact has less room beside a proof picture: one that would cut it is reported.
      if (!fits(slide)) return { slide: s, route: { to: "none", misses, why: "picture-over" } };
      return { slide, route: { to: "picture", misses } };
    }
    case "hinge": {
      // Icon tiles are for options that are each a thing (the menu: "options with icons: up to 2
      // words each"); a hinge of statements or numbers is a word hinge and wants no icon.
      const opts0 = (Array.isArray(s.options) ? s.options : []) as unknown[];
      const options = opts0.map((o) => (o && typeof o === "object" ? (o as S) : { text: o }));
      if (!options.length || isPic(s.figure)) return { slide: s };
      // An option's own icon the catalogue draws is kept; only the rest are misses.
      const resolved = options.map((o) =>
        hasIcon(o.icon) && resolveIcon(str(o.icon), { subject }) ? str(o.icon) : null,
      );
      if (resolved.every(Boolean)) return { slide: s };
      const things = options.every((o) => {
        const t = article(str(o.text).replace(/[.!?]+$/, ""));
        return !!t && t.split(/\s+/).length <= 3 && !/[0-9=]/.test(t);
      });
      // A writer that gave some options icons meant tiles; otherwise only options that are things.
      if (!things && !resolved.some(Boolean)) return { slide: s };
      const named = options.map(
        (o, n) => resolved[n] ?? iconNamed(str(o.text), str(o.text), around, subject),
      );
      const missed = (n: number) => !resolved[n];
      if (named.every(Boolean))
        return {
          slide: { ...s, options: options.map((o, n) => ({ ...o, icon: named[n] })) },
          route: {
            to: "catalogue",
            misses: options.flatMap((o, n) =>
              missed(n) ? [{ slot: `option.${n}`, name: str(o.text) }] : [],
            ),
          },
        };
      const misses = options.flatMap((o, n) =>
        named[n] ? [] : [{ slot: `option.${n}`, name: str(o.text) }],
      );
      // Options that are things, some the catalogue draws and some it lacks: the hinge has no
      // picture tile, so the tiles cannot be made honestly. Reported, never a near icon.
      return named.some(Boolean)
        ? { slide: s, route: { to: "none", misses, why: "hinge-no-picture-tile" } }
        : { slide: s };
    }
    default:
      return { slide: s };
  }
}

type Fit = {
  overs: readonly { path: string; chars: number; room: number; clipped: boolean }[];
  tooMany: boolean;
};
/**
 * Whether a routed slide fits no worse than the slide as written (both measured by `pilotOvers`):
 * no members dropped (`tooMany`), nothing clipped, and no field newly over or over by more (its
 * room shrank or its words grew), so a picture never costs the writer's words.
 */
export function fitsNoWorse(was: Fit, now: Fit): boolean {
  if (now.tooMany || now.overs.some((o) => o.clipped)) return false;
  const before = new Map(was.overs.map((o) => [o.path, o]));
  return now.overs.every((o) => {
    const b = before.get(o.path);
    return !!b && o.chars - o.room <= b.chars - b.room;
  });
}
