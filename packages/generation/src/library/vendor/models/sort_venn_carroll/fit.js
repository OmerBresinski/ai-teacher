// Text fitting without a DOM for sort_venn_carroll. wFn(s, cls) gives a width in slide units:
// the real measure in render(), the estimate (textw.js) in validate(). tbFit mirrors the kit's
// textBlock (wrap at the class, then shrink to ts-tiny, then cut), so the space it reserves is the
// space textBlock then draws in.
export const SIZE = {
  HUGE: { cls: 'ts-num', pr: 32, pad: 34, dy: 14, lh: 44 },
  BIG: { cls: 'ts-label', pr: 26, pad: 28, dy: 10, lh: 32 },
  SMALL: { cls: 'ts-small', pr: 21, pad: 22, dy: 8, lh: 27 },
  TINY: { cls: 'ts-tiny', pr: 18, pad: 18, dy: 7, lh: 24 },
};

export function wrapW(s, cls, maxW, wFn) {
  const words = String(s).split(/\s+/).filter(Boolean), out = []; let cur = '';
  for (const w of words) { const t = cur ? cur + ' ' + w : w; if (cur && wFn(t, cls) > maxW) { out.push(cur); cur = w; } else cur = t; }
  if (cur) out.push(cur); return out;
}
export function tbFit(s, cls, maxW, maxLines, lh, wFn) {
  let use = cls, L = [];
  for (const c of cls === 'ts-tiny' ? ['ts-tiny'] : [cls, 'ts-tiny']) { use = c; L = wrapW(s, c, maxW, wFn); if (L.length <= maxLines) break; }
  const cut = L.length > maxLines;
  if (cut) { L = L.slice(0, maxLines); L[maxLines - 1] = L[maxLines - 1].replace(/\s*\S*$/, '') + '…'; }
  const lhUse = use === 'ts-tiny' ? Math.min(lh, 26) : lh;
  return { L, cls: use, lh: lhUse, cut, w: Math.max(0, ...L.map(l => wFn(l, use))), h: L.length * lhUse };
}

/** A sorting card: one line, or (wrap 1 or 2) the label's words split over up to wrap + 1 lines,
 *  balanced so the widest line is as short as it can be. */
// picture cards: the picture above the word, on a rounded card (radius PIC_R, which the region
// test in venn.js uses in place of the pill's), sized with the word
export const PIC = { 'ts-num': 72, 'ts-label': 62, 'ts-small': 52, 'ts-tiny': 46 }, PIC_R = 16;
// inline: the picture left of the word on a pill, as tall as a word card (the tray, and tight regions)
export function cardShape(label, S, wrap, wFn, pic, inline) {
  const ws = String(label).trim().split(/\s+/);
  let L = [label], tw = wFn(label, S.cls);
  const tryLines = parts => { const m = Math.max(...parts.map(p => wFn(p, S.cls))); if (m < tw) { tw = m; L = parts; } };
  for (let i = 1; wrap >= 1 && i < ws.length; i++) {
    tryLines([ws.slice(0, i).join(' '), ws.slice(i).join(' ')]);
    for (let j = i + 1; wrap >= 2 && j < ws.length; j++) tryLines([ws.slice(0, i).join(' '), ws.slice(i, j).join(' '), ws.slice(j).join(' ')]);
  }
  const wordH = S.pr * 2 + (L.length - 1) * S.lh;
  if (!pic) return { L, tw, w: Math.max(S.pr * 2, tw + S.pad), h: wordH, pr: S.pr };
  if (inline) { const ps = S.pr * 2 - 8, w = tw + S.pad + ps + 8; return { L, tw, w, h: wordH, pr: S.pr, pic, ps, inline: true, picDx: -w / 2 + S.pad / 2 + ps / 2 - 4, picDy: 0, textDx: (ps + 8) / 2 - 4, textDy: 0 }; }
  // picture: 10 above it, then the word in a band 12 shorter than its pill
  const ps = PIC[S.cls], wh = wordH - 12, hh = 10 + ps + wh;
  return { L, tw, w: Math.max(ps + 30, tw + S.pad), h: hh, pr: PIC_R, pic, ps, picDy: -hh / 2 + 10 + ps / 2, textDy: -hh / 2 + 10 + ps + wh / 2 };
}
