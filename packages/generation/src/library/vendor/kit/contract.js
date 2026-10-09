// The model contract, and the helpers every model's validate() uses.
//
// A model is one ES module in models/ exporting:
//   meta      {id, name, kind: 'scene'|'info', subjects[], years[], teaches, version}
//   params    JSON Schema (draft 2020-12 subset). Teacher-language `title`s, `description`s,
//             `default`s and `enum`s (with `x-labels` for display words). It drives both the
//             writer's spec and the teacher panel. Every model includes TEXT_PARAM (`text`).
//   presets   [{id, name, params}]  e.g. "Year 2 version", "Year 6 version"
//   validate(params) -> {ok, refusals:[{path, reason}], warnings:[...]}
//             Refuses false science, a wrong scale or impossible maths, in teacher words.
//             Free wording is the teacher's choice and is never refused.
//   builds(params)   -> {steps:[{key, caption}], summary:{caption}}
//   render(root, params, theme) -> optional hooks {tick(k,u,t,dt), still(), reset(), dur:{key:ms}}
//             `theme` is the theme context: {name, uid, tk, b (build key -> index), N, rc()}.
//   notes(params)    -> {steps:[string], summary:string}  speaker notes per build
//
// Editable text: every visible word is real SVG text. Words from params carry
// data-edit="<path>"; text the code computes carries data-computed="<path of its source value>".
// Captions, the title and notes are overridable through params.text (TEXT_PARAM).

/** Kit policy for free wording: the most letters each role may hold, sized to the lane it is drawn
 *  in at the kit's type sizes. A model declares a field's role with the helpers below (or
 *  `'x-role'`) rather than picking its own number, so every model gets the same caps.
 *    label     a name on a mark, card or axis (one or two short lines)
 *    phrase    a short description beside a mark (two or three lines in a label lane)
 *    sentence  one sentence in a text block or callout
 *    title     the engine's slide title (one line, or two smaller lines)
 *    caption   the engine's caption line (one line, or two lines at --fs-min)
 *    note      speaker notes, never drawn on the slide */
export const WORD_CAPS = { label: 40, phrase: 60, sentence: 90, title: 70, caption: 180, note: 600 };
const wording = role => (title, def, extra = {}) => Object.assign({ type: 'string', title, default: def, maxLength: WORD_CAPS[role], 'x-role': role }, extra);
/** A free-wording field with the kit's cap for its role: LABEL_PARAM('Name', 'Heart'). */
export const LABEL_PARAM = wording('label');
export const PHRASE_PARAM = wording('phrase');
export const SENTENCE_PARAM = wording('sentence');

/** The shared `text` overrides map: keys are stable ids such as caption:<buildKey>,
 *  caption:summary, note:<buildKey>, label:<id>. Each kind of key has its role's cap. A label
 *  override may hold a name or a whole sentence, so it takes the sentence cap unless the model
 *  names its role with TEXT_PARAM_FOR. */
const TEXT_KEYS = {
  '^caption:': { type: 'string', title: 'Caption', maxLength: WORD_CAPS.caption, 'x-role': 'caption' },
  '^note:': { type: 'string', title: 'Speaker note', maxLength: WORD_CAPS.note, 'x-role': 'note' },
  '^label:': { type: 'string', title: 'Label', maxLength: WORD_CAPS.sentence, 'x-role': 'sentence' },
};
export const TEXT_PARAM = {
  type: 'object', title: 'Your wording', description: 'Wording you have changed by clicking on the slide. Leave empty to use ours.',
  patternProperties: TEXT_KEYS,
  additionalProperties: { type: 'string', title: 'Wording', maxLength: WORD_CAPS.sentence, 'x-role': 'sentence' }, default: {}, 'x-panel': 'hidden',
};
/** TEXT_PARAM with a role for particular label ids, so each override gets its lane's cap:
 *  TEXT_PARAM_FOR({ x: 'label', why: 'sentence', total: 'phrase' }) caps label:x at 40 letters. */
export const TEXT_PARAM_FOR = (roles = {}) => {
  const own = {}; const esc = k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  for (const [id, role] of Object.entries(roles)) own[`^label:${esc(id)}$`] = { type: 'string', title: 'Label', maxLength: WORD_CAPS[role], 'x-role': role };
  return Object.assign({}, TEXT_PARAM, { patternProperties: Object.assign(own, TEXT_KEYS) });
};
export const TITLE_PARAM = (def) => ({ type: 'string', title: 'Slide title', default: def, maxLength: WORD_CAPS.title, 'x-role': 'title' });
/** Schema of one key of an object schema: properties, then patternProperties, then additionalProperties. */
export function propSchema(schema, k) {
  if (schema.properties && schema.properties[k]) return schema.properties[k];
  for (const [re, s] of Object.entries(schema.patternProperties || {})) if (new RegExp(re).test(k)) return s;
  return typeof schema.additionalProperties === 'object' ? schema.additionalProperties : null;
}

export const clone = o => JSON.parse(JSON.stringify(o));
export function getPath(o, path) { return path.split('.').reduce((a, k) => a == null ? a : a[k], o); }
export function setPath(o, path, v) {
  const ks = path.split('.'); let a = o;
  for (let i = 0; i < ks.length - 1; i++) { const k = ks[i]; if (a[k] == null) a[k] = /^\d+$/.test(ks[i + 1]) ? [] : {}; a = a[k]; }
  a[ks[ks.length - 1]] = v; return o;
}
/** Fill defaults from the schema (deep, including array items). */
export function withDefaults(schema, v) {
  if (schema.type === 'object') {
    const out = Object.assign({}, v == null ? clone(schema.default || {}) : v);
    for (const [k, s] of Object.entries(schema.properties || {})) { if (out[k] === undefined && s.default !== undefined) out[k] = clone(s.default); if (out[k] !== undefined && (s.type === 'object' || s.type === 'array')) out[k] = withDefaults(s, out[k]); }
    return out;
  }
  if (schema.type === 'array' && Array.isArray(v) && schema.items) return v.map(x => withDefaults(schema.items, x));
  return v === undefined ? clone(schema.default) : v;
}
const nameOf = (s, path) => s.title ? `“${s.title}”` : path;
/** Structural check against the schema, with reasons in teacher words. */
export function schemaCheck(schema, v, path = '', out = []) {
  const at = path || '(all)'; const nm = nameOf(schema, path);
  if (v === undefined || v === null) return out;
  const t = schema.type;
  if (t === 'string') {
    if (typeof v !== 'string') out.push({ path: at, reason: `${nm} should be words.` });
    else { if (schema.enum && !schema.enum.includes(v)) out.push({ path: at, reason: `${nm} must be one of: ${(schema['x-labels'] || schema.enum).join(', ')}.` });
      if (schema.maxLength && v.length > schema.maxLength) out.push({ path: at, reason: `${nm} is too long to read from the back of the room (${v.length} letters, at most ${schema.maxLength}).` });
      if (schema.minLength && v.trim().length < schema.minLength) out.push({ path: at, reason: `${nm} is empty.` }); }
  } else if (t === 'number' || t === 'integer') {
    if (typeof v !== 'number' || Number.isNaN(v)) out.push({ path: at, reason: `${nm} should be a number.` });
    else { if (t === 'integer' && !Number.isInteger(v)) out.push({ path: at, reason: `${nm} should be a whole number.` });
      if (schema.minimum != null && v < schema.minimum) out.push({ path: at, reason: `${nm} must be at least ${schema.minimum}.` });
      if (schema.maximum != null && v > schema.maximum) out.push({ path: at, reason: `${nm} can be at most ${schema.maximum}.` }); }
  } else if (t === 'boolean') { if (typeof v !== 'boolean') out.push({ path: at, reason: `${nm} should be on or off.` }); }
  else if (t === 'array') {
    if (!Array.isArray(v)) out.push({ path: at, reason: `${nm} should be a list.` });
    else { if (schema.maxItems != null && v.length > schema.maxItems) out.push({ path: at, reason: `${nm} has ${v.length} items; one slide holds at most ${schema.maxItems}.` });
      if (schema.minItems != null && v.length < schema.minItems) out.push({ path: at, reason: `${nm} needs at least ${schema.minItems}.` });
      v.forEach((x, i) => schemaCheck(schema.items || {}, x, path ? `${path}.${i}` : String(i), out)); }
  } else if (t === 'object') {
    if (typeof v !== 'object' || Array.isArray(v)) out.push({ path: at, reason: `${nm} is the wrong shape.` });
    else {
      for (const r of schema.required || []) if (v[r] === undefined || v[r] === '') out.push({ path: path ? `${path}.${r}` : r, reason: `${nameOf(schema.properties[r] || {}, r)} is missing.` });
      for (const [k, x] of Object.entries(v)) { const s = propSchema(schema, k); if (s) schemaCheck(s, x, path ? `${path}.${k}` : k, out); }
    }
  }
  return out;
}
/** Combine schema refusals and truth refusals into the validate() result. */
export const result = (refusals, warnings = []) => ({ ok: refusals.length === 0, refusals, warnings });

/** Contract check the gallery runs on every model it loads. Returns a list of problems. */
export function checkModel(mod) {
  const bad = [];
  for (const k of ['meta', 'params', 'presets', 'validate', 'builds', 'render', 'notes']) if (!(k in mod)) bad.push(`missing export ${k}`);
  if (bad.length) return bad;
  for (const k of ['id', 'name', 'subjects', 'years', 'teaches']) if (!mod.meta[k]) bad.push(`meta.${k} missing`);
  if (!mod.params.properties || !mod.params.properties.text) bad.push('params has no `text` overrides map (TEXT_PARAM)');
  for (const pr of mod.presets) {
    const P = withDefaults(mod.params, pr.params); const v = mod.validate(P);
    if (!v.ok) bad.push(`preset “${pr.name}” is refused: ${v.refusals.map(r => r.reason).join(' ')}`);
    else { const b = mod.builds(P), n = mod.notes(P); if (b.steps.length !== n.steps.length) bad.push(`preset “${pr.name}”: ${b.steps.length} builds but ${n.steps.length} notes`); }
  }
  return bad;
}
