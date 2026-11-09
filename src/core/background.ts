/**
 * Background detection for the atlas (ported from the Python/scipy version).
 *
 * GPT Image / SeeDream usually render a solid WHITE (or chroma) backdrop rather
 * than real alpha. We colour-key it and keep ONLY background regions connected
 * to the image border (flood fill), so same-colour highlights INSIDE a sprite
 * are preserved as content.
 */
import type { ProcessParams } from "../types";
import type { Raster } from "./image";

export interface BgResult {
  /** 1 = background, 0 = content */
  mask: Uint8Array;
  color: [number, number, number];
}

const KEY_COLORS: Record<string, [number, number, number]> = {
  white: [255, 255, 255],
  black: [0, 0, 0],
  magenta: [255, 0, 255],
  green: [0, 255, 0],
};

function cornerColor(r: Raster): [number, number, number] {
  const p = Math.max(1, Math.min(12, Math.floor(r.w / 12), Math.floor(r.h / 12)));
  const pts: [number, number][] = [
    [0, 0],
    [r.w - p, 0],
    [0, r.h - p],
    [r.w - p, r.h - p],
  ];
  const channels: number[][] = [[], [], []];
  for (const [ox, oy] of pts) {
    for (let y = oy; y < oy + p; y += 1) {
      for (let x = ox; x < ox + p; x += 1) {
        const i = (y * r.w + x) * 4;
        for (let c = 0; c < 3; c += 1) channels[c].push(r.data[i + c]);
      }
    }
  }
  return channels.map((arr) => {
    arr.sort((a, b) => a - b);
    return arr[Math.floor(arr.length / 2)];
  }) as [number, number, number];
}

/** Separable 3x3 dilation / erosion (equivalent to a 3x3 box structuring element). */
function morphPass(src: Uint8Array, w: number, h: number, horizontal: boolean, isMax: boolean): Uint8Array {
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      let v = isMax ? 0 : 1;
      for (let d = -1; d <= 1; d += 1) {
        const sx = horizontal ? Math.min(w - 1, Math.max(0, x + d)) : x;
        const sy = horizontal ? y : Math.min(h - 1, Math.max(0, y + d));
        const c = src[sy * w + sx];
        v = isMax ? Math.max(v, c) : Math.min(v, c);
      }
      out[y * w + x] = v;
    }
  }
  return out;
}

function closing(cand: Uint8Array, w: number, h: number): Uint8Array {
  const dil = morphPass(morphPass(cand, w, h, true, true), w, h, false, true);
  return morphPass(morphPass(dil, w, h, true, false), w, h, false, false);
}

/** Keep only candidate components reachable from the border (8-connectivity). */
function borderConnected(cand: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h);
  const stack = new Int32Array(w * h);
  let sp = 0;
  const push = (idx: number) => {
    if (cand[idx] && !out[idx]) {
      out[idx] = 1;
      stack[sp++] = idx;
    }
  };
  for (let x = 0; x < w; x += 1) {
    push(x);
    push((h - 1) * w + x);
  }
  for (let y = 0; y < h; y += 1) {
    push(y * w);
    push(y * w + w - 1);
  }
  while (sp > 0) {
    const idx = stack[--sp];
    const y = Math.floor(idx / w);
    const x = idx - y * w;
    for (let dy = -1; dy <= 1; dy += 1) {
      const ny = y + dy;
      if (ny < 0 || ny >= h) continue;
      for (let dx = -1; dx <= 1; dx += 1) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx;
        if (nx < 0 || nx >= w) continue;
        push(ny * w + nx);
      }
    }
  }
  return out;
}

export function bgSignature(p: ProcessParams): string {
  return `${p.background}|${p.background_tolerance}|${p.alpha_threshold}`;
}

export function buildBackgroundMask(r: Raster, p: ProcessParams): BgResult {
  const { w, h, data } = r;
  const n = w * h;
  const transparent = new Uint8Array(n);
  let transparentCount = 0;
  for (let i = 0; i < n; i += 1) {
    if (data[i * 4 + 3] < p.alpha_threshold) {
      transparent[i] = 1;
      transparentCount += 1;
    }
  }

  if (p.background === "none") {
    return { mask: new Uint8Array(n), color: [255, 255, 255] };
  }
  if (p.background === "transparent") {
    return { mask: transparent, color: [255, 255, 255] };
  }

  let color: [number, number, number];
  if (p.background === "auto") {
    if (transparentCount / n > 0.05) {
      return { mask: transparent, color: [255, 255, 255] };
    }
    color = cornerColor(r);
  } else {
    color = KEY_COLORS[p.background] ?? [255, 255, 255];
  }

  const tol = p.background_tolerance;
  const candidates = new Uint8Array(n);
  for (let i = 0; i < n; i += 1) {
    const diff = Math.max(
      Math.abs(data[i * 4] - color[0]),
      Math.abs(data[i * 4 + 1] - color[1]),
      Math.abs(data[i * 4 + 2] - color[2])
    );
    candidates[i] = diff <= tol || transparent[i] ? 1 : 0;
  }

  const closed = closing(candidates, w, h);
  // Give the flood fill explicit seeds at the outermost ring.
  for (let x = 0; x < w; x += 1) {
    closed[x] = 1;
    closed[(h - 1) * w + x] = 1;
  }
  for (let y = 0; y < h; y += 1) {
    closed[y * w] = 1;
    closed[y * w + w - 1] = 1;
  }

  return { mask: borderConnected(closed, w, h), color };
}
