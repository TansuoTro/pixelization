/**
 * MedianCut colour quantization (ported from Pillow's MEDIANCUT, no dithering),
 * preserving strict binary alpha and excluding transparent pixels from the
 * palette calculation.
 */
import type { Raster } from "./image";
import { hexOf } from "./image";

interface Box {
  indices: number[];
  min: [number, number, number];
  max: [number, number, number];
}

function makeBox(r: Raster, indices: number[]): Box {
  const min: [number, number, number] = [255, 255, 255];
  const max: [number, number, number] = [0, 0, 0];
  for (const px of indices) {
    for (let c = 0; c < 3; c += 1) {
      const v = r.data[px * 4 + c];
      if (v < min[c]) min[c] = v;
      if (v > max[c]) max[c] = v;
    }
  }
  return { indices, min, max };
}

function averageColor(r: Raster, indices: number[]): [number, number, number] {
  let s0 = 0;
  let s1 = 0;
  let s2 = 0;
  for (const px of indices) {
    s0 += r.data[px * 4];
    s1 += r.data[px * 4 + 1];
    s2 += r.data[px * 4 + 2];
  }
  const n = Math.max(1, indices.length);
  return [s0 / n, s1 / n, s2 / n];
}

export function quantizeMedianCut(r: Raster, numColors: number, alphaThreshold: number): Raster {
  const out = { w: r.w, h: r.h, data: new Uint8ClampedArray(r.data) };
  const opaque: number[] = [];
  for (let px = 0; px < r.w * r.h; px += 1) {
    if (out.data[px * 4 + 3] > alphaThreshold) opaque.push(px);
  }
  if (opaque.length === 0) {
    out.data.fill(0);
    return out;
  }

  let boxes: Box[] = [makeBox(r, opaque)];
  while (boxes.length < numColors) {
    let bestIdx = -1;
    let bestRange = 0;
    let bestChannel = 0;
    boxes.forEach((box, bi) => {
      for (let c = 0; c < 3; c += 1) {
        const range = box.max[c] - box.min[c];
        if (range > bestRange) {
          bestRange = range;
          bestIdx = bi;
          bestChannel = c;
        }
      }
    });
    if (bestIdx < 0 || bestRange <= 0 || boxes[bestIdx].indices.length < 2) break;

    const box = boxes[bestIdx];
    const ch = bestChannel;
    box.indices.sort((a, b) => r.data[a * 4 + ch] - r.data[b * 4 + ch]);
    const mid = Math.floor(box.indices.length / 2);
    const left = box.indices.slice(0, mid);
    const right = box.indices.slice(mid);
    if (left.length === 0 || right.length === 0) break;
    boxes = [
      ...boxes.slice(0, bestIdx),
      makeBox(r, left),
      makeBox(r, right),
      ...boxes.slice(bestIdx + 1),
    ];
  }

  const palette = boxes.map((b) => averageColor(r, b.indices));
  for (const px of opaque) {
    const rr = out.data[px * 4];
    const gg = out.data[px * 4 + 1];
    const bb = out.data[px * 4 + 2];
    let best = 0;
    let bestDist = Infinity;
    palette.forEach((color, ci) => {
      const d =
        (rr - color[0]) ** 2 + (gg - color[1]) ** 2 + (bb - color[2]) ** 2;
      if (d < bestDist) {
        bestDist = d;
        best = ci;
      }
    });
    out.data[px * 4] = palette[best][0];
    out.data[px * 4 + 1] = palette[best][1];
    out.data[px * 4 + 2] = palette[best][2];
  }
  return out;
}

export function extractPalette(r: Raster, limit = 64): string[] {
  const counts = new Map<string, number>();
  for (let px = 0; px < r.w * r.h; px += 1) {
    if (r.data[px * 4 + 3] === 0) continue;
    const key = hexOf(r.data[px * 4], r.data[px * 4 + 1], r.data[px * 4 + 2]);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([hex]) => hex);
}
