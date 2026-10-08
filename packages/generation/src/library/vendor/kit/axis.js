// Nice round tick values for a numeric axis (1, 2, 5 x 10^n steps), spacing always honest.
export function niceTicks(d0, d1, count = 8) {
  const span = d1 - d0; if (!(span > 0)) return [d0];
  const raw = span / count, mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 5, 10].map(m => m * mag).find(s => s >= raw) || 10 * mag;
  const out = []; for (let v = Math.ceil(d0 / step - 1e-9) * step; v <= d1 + 1e-9; v += step) out.push(+v.toFixed(10));
  return out;
}
