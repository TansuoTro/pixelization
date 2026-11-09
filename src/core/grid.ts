/**
 * Grid-line detection (ported from the Python projection-profile algorithm).
 *
 * The expected grid is a strong prior (we asked the model for an aligned
 * grid), so for each interior boundary we search a +/-30% window around it for
 * the widest "background gutter" plateau and take its centre. Degenerate
 * results fall back to a perfectly uniform split.
 */

export interface GridDetection {
  lines: number[];
  detected: boolean;
}

function uniform(length: number, count: number): number[] {
  return Array.from({ length: count + 1 }, (_, i) => Math.round((i * length) / count));
}

function boxSmooth(a: Float32Array, k: number): Float32Array {
  const n = a.length;
  const half = Math.floor(k / 2);
  const prefix = new Float64Array(n + 1);
  for (let i = 0; i < n; i += 1) prefix[i + 1] = prefix[i] + a[i];
  const out = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    const lo = Math.max(0, i - half);
    const hi = Math.min(n - 1, i + half);
    out[i] = (prefix[hi + 1] - prefix[lo]) / (hi - lo + 1);
  }
  return out;
}

export function detectGridLines(
  mask: Uint8Array,
  w: number,
  h: number,
  count: number,
  axis: "x" | "y",
  enabled: boolean
): GridDetection {
  const length = axis === "x" ? w : h;
  if (count <= 1 || !enabled) return { lines: uniform(length, count), detected: false };

  const profile = new Float32Array(length);
  if (axis === "x") {
    for (let x = 0; x < w; x += 1) {
      let sum = 0;
      for (let y = 0; y < h; y += 1) sum += mask[y * w + x];
      profile[x] = sum / h;
    }
  } else {
    for (let y = 0; y < h; y += 1) {
      let sum = 0;
      const row = y * w;
      for (let x = 0; x < w; x += 1) sum += mask[row + x];
      profile[y] = sum / w;
    }
  }

  const k = Math.max(3, Math.floor(length / 200) * 2 + 1);
  const smoothed = boxSmooth(profile, k);
  const step = length / count;
  const lines = [0];

  for (let i = 1; i < count; i += 1) {
    const expected = i * step;
    const half = Math.max(2, step * 0.3);
    const lo = Math.max(lines[lines.length - 1] + 1, Math.floor(expected - half));
    const hi = Math.min(length - 1, Math.ceil(expected + half));
    if (hi <= lo) {
      lines.push(Math.round(expected));
      continue;
    }

    let peak = 0;
    for (let j = lo; j <= hi; j += 1) peak = Math.max(peak, smoothed[j]);
    const threshold = peak - Math.max(0.01, peak * 0.02);

    let bestStart = -1;
    let bestEnd = -1;
    let runStart = -1;
    for (let j = lo; j <= hi + 1; j += 1) {
      const above = j <= hi && smoothed[j] >= threshold;
      if (above && runStart < 0) runStart = j;
      if (!above && runStart >= 0) {
        const end = j - 1;
        if (bestStart < 0 || end - runStart > bestEnd - bestStart) {
          bestStart = runStart;
          bestEnd = end;
        }
        runStart = -1;
      }
    }
    if (bestStart < 0) {
      let argmax = lo;
      for (let j = lo; j <= hi; j += 1) if (smoothed[j] > smoothed[argmax]) argmax = j;
      lines.push(argmax);
    } else {
      lines.push(Math.floor((bestStart + bestEnd) / 2));
    }
  }
  lines.push(length);

  const fixed: number[] = [];
  let prev = -1;
  for (const line of lines) {
    const v = Math.min(Math.max(line, prev + 1), length);
    fixed.push(v);
    prev = v;
  }
  fixed[fixed.length - 1] = length;

  const degenerate = fixed.some(
    (_, i) => i < count && fixed[i + 1] - fixed[i] < length / (count * 3)
  );
  if (degenerate) return { lines: uniform(length, count), detected: false };
  return { lines: fixed, detected: true };
}
