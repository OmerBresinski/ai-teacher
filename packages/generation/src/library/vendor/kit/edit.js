// Direct text editing on the slide (editor only, never in Present).
// Click a word with data-edit="<path>": an inline input opens over it; Enter or leaving the
// field writes the new wording back into params at <path> and the slide re-renders (labels
// re-measure, pills resize, flags re-place). Click a word with data-computed="<path>": it is
// computed from a value, so nothing opens on the slide and the panel focuses that value instead.
import { getPath } from './contract.js';

export function attachEditing(stage, { onEdit, onFocusParam, enabled = () => true }) {
  const host = stage.slide;
  host.classList.add('editable');
  let box = null;
  function close(commit) {
    if (!box) return; const { input, path, before } = box; box = null; input.remove();
    if (commit && input.value !== before) onEdit(path, input.value.replace(/\s+/g, ' ').trim());
  }
  host.addEventListener('click', e => {
    if (!enabled() || host.closest('.pv')) return;
    const t = e.target.closest('[data-edit],[data-computed]'); if (!t || !host.contains(t)) return;
    e.stopPropagation();
    if (t.dataset.computed !== undefined) { onFocusParam && onFocusParam(t.dataset.computed, t.textContent); return; }
    close(true);
    const path = t.dataset.edit; const cur = getPath(stage.params, path);
    const before = typeof cur === 'string' ? cur : t.textContent;
    const r = t.getBoundingClientRect(), hr = host.getBoundingClientRect();
    const fs = parseFloat(getComputedStyle(t).fontSize) * (hr.width / 1280);
    const input = document.createElement(before.length > 40 ? 'textarea' : 'input');
    input.className = 'inline-edit'; input.value = before; input.setAttribute('aria-label', 'Edit wording');
    Object.assign(input.style, {
      left: Math.max(0, r.left - hr.left - 6) + 'px', top: Math.max(0, r.top - hr.top - 4) + 'px',
      width: Math.min(hr.width - (r.left - hr.left) + 6, Math.max(r.width + 60, 220)) + 'px',
      fontSize: Math.max(12, fs) + 'px', fontFamily: getComputedStyle(t).fontFamily, fontWeight: getComputedStyle(t).fontWeight,
      height: before.length > 40 ? Math.max(r.height + 12, fs * 2.8) + 'px' : (fs * 1.5) + 'px',
    });
    host.appendChild(input); input.focus(); input.select();
    box = { input, path, before };
    input.addEventListener('keydown', ev => { if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); close(true); } else if (ev.key === 'Escape') { ev.preventDefault(); close(false); } ev.stopPropagation(); });
    input.addEventListener('blur', () => close(true));
  });
  return { close };
}
