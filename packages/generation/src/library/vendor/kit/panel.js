// Teacher panel generated from a model's params schema (ruling 182). It never appears in Present.
// string -> text box, string+enum -> select (x-labels for display words), number/integer -> number box,
// boolean -> switch, object -> group, array of objects -> repeating cards with Add and Remove.
// Fields marked 'x-panel': 'hidden' are skipped; 'x-panel': 'advanced' go in a closed group.
import { clone, getPath, setPath } from './contract.js';

export function renderPanel(el, schema, params, { onChange, refusals = [] } = {}) {
  el.textContent = '';
  const P = clone(params);
  const emit = () => onChange && onChange(clone(P));
  const byPath = {}; for (const r of refusals) (byPath[r.path] = byPath[r.path] || []).push(r.reason);
  const adv = document.createElement('details'); adv.className = 'pn-adv'; adv.innerHTML = '<summary>More settings</summary>';
  for (const [k, s] of Object.entries(schema.properties || {})) {
    if (s['x-panel'] === 'hidden') continue;
    field(s['x-panel'] === 'advanced' ? adv : el, s, k);
  }
  if (adv.children.length > 1) el.appendChild(adv);

  function err(wrap, path) { for (const r of byPath[path] || []) { const p = document.createElement('p'); p.className = 'pn-err'; p.textContent = r; wrap.appendChild(p); } }
  function field(parent, s, path) {
    const v = getPath(P, path);
    const wrap = document.createElement('div'); wrap.className = 'pn-field'; wrap.dataset.path = path;
    const id = 'pn-' + path.replace(/[^a-z0-9]/gi, '-');
    if (s.type === 'array' && s.items && s.items.type === 'object') {
      const fs = document.createElement('fieldset'); fs.className = 'pn-list'; fs.innerHTML = `<legend>${s.title || path}</legend>`;
      if (s.description) fs.insertAdjacentHTML('beforeend', `<p class="pn-help">${s.description}</p>`);
      (v || []).forEach((item, i) => {
        const card = document.createElement('div'); card.className = 'pn-card'; card.dataset.path = `${path}.${i}`;
        for (const [kk, ss] of Object.entries(s.items.properties || {})) if (ss['x-panel'] !== 'hidden') field(card, ss, `${path}.${i}.${kk}`);
        const rm = document.createElement('button'); rm.type = 'button'; rm.className = 'pn-rm'; rm.textContent = 'Remove';
        rm.onclick = () => { getPath(P, path).splice(i, 1); emit(); }; card.appendChild(rm); err(card, `${path}.${i}`); fs.appendChild(card);
      });
      if (s.maxItems == null || (v || []).length < s.maxItems) {
        const add = document.createElement('button'); add.type = 'button'; add.className = 'pn-add'; add.textContent = `Add ${s['x-item'] || 'one'}`;
        add.onclick = () => { const arr = getPath(P, path) || setPath(P, path, []) && getPath(P, path); arr.push(clone(s.items.default || {})); emit(); }; fs.appendChild(add);
      }
      err(fs, path); parent.appendChild(fs); return;
    }
    if (s.type === 'object') {
      const fs = document.createElement('fieldset'); fs.className = 'pn-group'; fs.innerHTML = `<legend>${s.title || path}</legend>`;
      if (s.description) fs.insertAdjacentHTML('beforeend', `<p class="pn-help">${s.description}</p>`);
      for (const [kk, ss] of Object.entries(s.properties || {})) if (ss['x-panel'] !== 'hidden') field(fs, ss, `${path}.${kk}`);
      err(fs, path); parent.appendChild(fs); return;
    }
    const lab = document.createElement('label'); lab.htmlFor = id; lab.textContent = s.title || path; wrap.appendChild(lab);
    let input;
    if (s.enum) { input = document.createElement('select'); s.enum.forEach((e, i) => { const o = document.createElement('option'); o.value = e; o.textContent = (s['x-labels'] || s.enum)[i]; input.appendChild(o); }); input.value = v ?? s.default ?? ''; input.onchange = () => { setPath(P, path, input.value); emit(); }; }
    else if (s.type === 'boolean') { input = document.createElement('input'); input.type = 'checkbox'; input.checked = !!v; input.onchange = () => { setPath(P, path, input.checked); emit(); }; wrap.classList.add('pn-bool'); }
    else if (s.type === 'number' || s.type === 'integer') { input = document.createElement('input'); input.type = 'number'; if (s.minimum != null) input.min = s.minimum; if (s.maximum != null) input.max = s.maximum; input.value = v ?? ''; input.onchange = () => { setPath(P, path, input.value === '' ? undefined : Number(input.value)); emit(); }; }
    else { input = document.createElement('input'); input.type = 'text'; input.value = v ?? ''; if (s.examples) input.placeholder = s.examples[0]; input.onchange = () => { setPath(P, path, input.value); emit(); }; }
    input.id = id; wrap.appendChild(input);
    if (s.description) wrap.insertAdjacentHTML('beforeend', `<p class="pn-help">${s.description}</p>`);
    err(wrap, path); parent.appendChild(wrap);
  }
}
/** Scroll to and focus the panel field for a params path (used when a computed label is clicked). */
export function focusField(el, path, why) {
  let p = path, f = null;
  while (p && !(f = el.querySelector(`[data-path="${CSS.escape(p)}"]`))) p = p.includes('.') ? p.slice(0, p.lastIndexOf('.')) : '';
  if (!f) return false;
  const det = f.closest('details'); if (det) det.open = true;
  f.scrollIntoView({ block: 'center', behavior: 'smooth' });
  f.classList.remove('pn-flash'); void f.offsetWidth; f.classList.add('pn-flash');
  const inp = f.querySelector('input,select,textarea'); inp && inp.focus({ preventScroll: true });
  if (why) { let n = f.querySelector('.pn-why'); if (!n) { n = document.createElement('p'); n.className = 'pn-why'; f.appendChild(n); } n.textContent = why; }
  return true;
}
