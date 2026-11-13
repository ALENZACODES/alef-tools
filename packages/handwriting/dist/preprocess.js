export const SIZE = 32;
export const BOX = 24;
export const INK_MIN = 0.25;
export function strokesTo32(strokes, { pen = 1.3 } = {}) {
 const out = new Float32Array(SIZE * SIZE);
 const list = (strokes || []).filter((s) => s && s.length >= 1);
 if (!list.length) return out;
 let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
 for (const s of list) for (let i = 0; i < s.length; i++) { const x = s[i][0], y = s[i][1]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
 const span = Math.max(x1 - x0, y1 - y0);
 const scale = span > 1e-9 ? (BOX - 2 * pen) / span : 0;
 const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
 const best = new Float32Array(SIZE * SIZE).fill(1e9);
 const seg = (ax, ay, bx, by) => {
  const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
  const reach = pen + 1.5;
  const ya = Math.max(0, Math.floor(Math.min(ay, by) - reach)), yb = Math.min(SIZE - 1, Math.ceil(Math.max(ay, by) + reach));
  const xa = Math.max(0, Math.floor(Math.min(ax, bx) - reach)), xb = Math.min(SIZE - 1, Math.ceil(Math.max(ax, bx) + reach));
  for (let y = ya; y <= yb; y++) for (let x = xa; x <= xb; x++) {
   const px = x + 0.5, py = y + 0.5;
   let t = L2 < 1e-12 ? 0 : ((px - ax) * dx + (py - ay) * dy) / L2;
   t = t < 0 ? 0 : t > 1 ? 1 : t;
   const d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
   const i = y * SIZE + x;
   if (d < best[i]) best[i] = d;
  }
 };
 for (const s of list) {
  const q = [];
  for (let i = 0; i < s.length; i++) q.push([(s[i][0] - cx) * scale + SIZE / 2, (s[i][1] - cy) * scale + SIZE / 2]);
  if (q.length === 1) q.push(q[0]);
  for (let i = 1; i < q.length; i++) seg(q[i - 1][0], q[i - 1][1], q[i][0], q[i][1]);
 }
 for (let i = 0; i < out.length; i++) { const v = pen + 0.5 - best[i]; out[i] = v <= 0 ? 0 : v >= 1 ? 1 : v; }
 return out;
}
export function inkFromImageData(img) {
 const { data, width, height } = img;
 const n = width * height;
 const ink = new Float32Array(n);
 let clear = false;
 for (let i = 0; i < n; i++) if (data[i * 4 + 3] < 128) { clear = true; break; }
 if (clear) { for (let i = 0; i < n; i++) ink[i] = data[i * 4 + 3] / 255; return { ink, width, height }; }
 const hist = new Uint32Array(256);
 const grey = new Float32Array(n);
 for (let i = 0; i < n; i++) { const g = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2]; grey[i] = g; hist[Math.min(255, Math.round(g))]++; }
 const pct = (p) => { let c = 0; const want = p * n; for (let v = 0; v < 256; v++) { c += hist[v]; if (c >= want) return v; } return 255; };
 const paper = pct(0.95), dark = pct(0.02);
 if (paper - dark < 20) return { ink, width, height };
 for (let i = 0; i < n; i++) { const v = (paper - grey[i]) / (paper - dark); ink[i] = v <= 0 ? 0 : v >= 1 ? 1 : v; }
 return { ink, width, height };
}
export function norm32(ink, width, height) {
 const out = new Float32Array(SIZE * SIZE);
 let x0 = width, y0 = height, x1 = -1, y1 = -1;
 for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (ink[y * width + x] > INK_MIN) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
 if (x1 < 0) return out;
 const w = x1 - x0 + 1, h = y1 - y0 + 1;
 const s = BOX / Math.max(w, h);
 const nw = Math.max(1, Math.round(w * s)), nh = Math.max(1, Math.round(h * s));
 const ox = (SIZE - nw) >> 1, oy = (SIZE - nh) >> 1;
 const at = (x, y) => ink[(y0 + y) * width + (x0 + x)];
 if (s < 1) {                                   // shrinking: each output pixel is the average of the source area it covers
  const fx = w / nw, fy = h / nh;
  for (let Y = 0; Y < nh; Y++) for (let X = 0; X < nw; X++) {
   const sx0 = X * fx, sx1 = (X + 1) * fx, sy0 = Y * fy, sy1 = (Y + 1) * fy;
   let sum = 0, area = 0;
   for (let y = Math.floor(sy0); y < Math.min(h, Math.ceil(sy1)); y++) {
    const wy = Math.min(sy1, y + 1) - Math.max(sy0, y);
    for (let x = Math.floor(sx0); x < Math.min(w, Math.ceil(sx1)); x++) { const wx = Math.min(sx1, x + 1) - Math.max(sx0, x); sum += at(x, y) * wx * wy; area += wx * wy; }
   }
   out[(oy + Y) * SIZE + ox + X] = area ? sum / area : 0;
  }
 } else {                                       // enlarging: bilinear, pixel centres
  for (let Y = 0; Y < nh; Y++) for (let X = 0; X < nw; X++) {
   const gx = Math.min(w - 1, Math.max(0, (X + 0.5) * (w / nw) - 0.5)), gy = Math.min(h - 1, Math.max(0, (Y + 0.5) * (h / nh) - 0.5));
   const xa = Math.floor(gx), ya = Math.floor(gy), xb = Math.min(w - 1, xa + 1), yb = Math.min(h - 1, ya + 1), tx = gx - xa, ty = gy - ya;
   out[(oy + Y) * SIZE + ox + X] = (at(xa, ya) * (1 - tx) + at(xb, ya) * tx) * (1 - ty) + (at(xa, yb) * (1 - tx) + at(xb, yb) * tx) * ty;
  }
 }
 return out;
}
export function imageDataTo32(img) { const m = inkFromImageData(img); return norm32(m.ink, m.width, m.height); }
export function penFor(strokeWidth, span) {
 if (!(span > 0) || !(strokeWidth > 0)) return 1.3;
 const r = (strokeWidth / 2) * (BOX / span);
 return Math.min(2.2, Math.max(0.8, r));
}
export function extentOf(strokes) {
 let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
 for (const s of strokes || []) for (let i = 0; i < s.length; i++) { const x = s[i][0], y = s[i][1]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
 if (!Number.isFinite(x0)) return { width: 0, height: 0, top: 0, bottom: 0 };
 return { width: x1 - x0, height: y1 - y0, top: y0, bottom: y1 };
}
