/**
 * Separable resampling with 6 selectable filters (ported conceptually from the
 * Pillow pipeline, implemented in pure TypeScript).
 *
 * Key details:
 *  - Kernel support is widened by the downscale factor so high-quality filters
 *    (Lanczos/Bicubic/Hamming) actually LOW-PASS the source instead of aliasing.
 *  - Filtering runs in PREMULTIPLIED alpha space, which prevents white/black
 *    halos around transparent sprite edges.
 */
import type { ResampleMethod } from "../types";
import { blankRaster, type Raster } from "./image";

function sinc(x: number): number {
  if (Math.abs(x) < 1e-9) return 1;
  const px = Math.PI * x;
  return Math.sin(px) / px;
}

/** Returns kernel weight and its base support radius. */
function kernel(method: ResampleMethod, x: number): number {
  const ax = Math.abs(x);
  switch (method) {
    case "bilinear":
      return ax < 1 ? 1 - ax : 0;
    case "bicubic": {
      // Catmull-Rom (a = -0.5)
      const a = -0.5;
      if (ax < 1) return (a + 2) * ax ** 3 - (a + 3) * ax ** 2 + 1;
      if (ax < 2) return a * ax ** 3 - 5 * a * ax ** 2 + 8 * a * ax - 4 * a;
      return 0;
    }
    case "lanczos":
      return ax < 3 ? sinc(x) * sinc(x / 3) : 0;
    case "hamming":
      // Hamming-windowed sinc, radius 1 (matches Pillow's HAMMING)
      return ax <= 1 ? 0.54 + 0.46 * Math.cos(Math.PI * x) : 0;
    default:
      return ax < 1 ? 1 : 0;
  }
}

function baseRadius(method: ResampleMethod): number {
  switch (method) {
    case "lanczos":
      return 3;
    case "bicubic":
      return 2;
    default:
      return 1;
  }
}

/** Convert to straight RGBA -> premultiplied Float32 (RGB already multiplied by a). */
function toPremultiplied(src: Raster): Float32Array {
  const out = new Float32Array(src.w * src.h * 4);
  for (let i = 0; i < src.w * src.h; i += 1) {
    const a = src.data[i * 4 + 3] / 255;
    out[i * 4] = src.data[i * 4] * a;
    out[i * 4 + 1] = src.data[i * 4 + 1] * a;
    out[i * 4 + 2] = src.data[i * 4 + 2] * a;
    out[i * 4 + 3] = src.data[i * 4 + 3];
  }
  return out;
}

/** One separable pass: resample along X (axis=0) or Y (axis=1). */
function pass(
  src: Float32Array,
  sw: number,
  sh: number,
  dstLen: number,
  axis: 0 | 1,
  method: ResampleMethod
): { data: Float32Array; w: number; h: number } {
  const srcLen = axis === 0 ? sw : sh;
  const cross = axis === 0 ? sh : sw;
  const outW = axis === 0 ? dstLen : sw;
  const outH = axis === 0 ? sh : dstLen;
  const out = new Float32Array(outW * outH * 4);

  const scale = srcLen / dstLen;
  const filterScale = Math.max(1, scale);
  const support = baseRadius(method) * filterScale;

  for (let c = 0; c < cross; c += 1) {
    for (let d = 0; d < dstLen; d += 1) {
      const center = (d + 0.5) * scale - 0.5;
      let lo: number;
      let hi: number;
      if (method === "box") {
        lo = Math.floor(d * scale);
        hi = Math.max(lo + 1, Math.ceil((d + 1) * scale));
      } else if (method === "nearest") {
        lo = Math.min(srcLen - 1, Math.max(0, Math.floor((d + 0.5) * scale)));
        hi = lo + 1;
      } else {
        lo = Math.max(0, Math.floor(center - support));
        hi = Math.min(srcLen, Math.ceil(center + support) + 1);
      }

      let acc0 = 0;
      let acc1 = 0;
      let acc2 = 0;
      let acc3 = 0;
      let wsum = 0;
      for (let s = lo; s < hi; s += 1) {
        let w = 1;
        if (method !== "box" && method !== "nearest") {
          w = kernel(method, (center - s) / filterScale);
          if (w === 0) continue;
        }
        const si = axis === 0 ? (c * sw + s) * 4 : (s * sw + c) * 4;
        acc0 += src[si] * w;
        acc1 += src[si + 1] * w;
        acc2 += src[si + 2] * w;
        acc3 += src[si + 3] * w;
        wsum += w;
      }
      const di = axis === 0 ? (c * outW + d) * 4 : (d * outW + c) * 4;
      if (wsum > 0) {
        out[di] = acc0 / wsum;
        out[di + 1] = acc1 / wsum;
        out[di + 2] = acc2 / wsum;
        out[di + 3] = acc3 / wsum;
      }
    }
  }
  return { data: out, w: outW, h: outH };
}

export function resample(src: Raster, dw: number, dh: number, method: ResampleMethod): Raster {
  const premul = toPremultiplied(src);
  const hPass = pass(premul, src.w, src.h, dw, 0, method);
  const vPass = pass(hPass.data, hPass.w, hPass.h, dh, 1, method);

  const out = blankRaster(dw, dh);
  for (let i = 0; i < dw * dh; i += 1) {
    const a = vPass.data[i * 4 + 3] / 255;
    const inv = a > 1e-6 ? 1 / a : 0;
    out.data[i * 4] = Math.min(255, Math.max(0, vPass.data[i * 4] * inv));
    out.data[i * 4 + 1] = Math.min(255, Math.max(0, vPass.data[i * 4 + 1] * inv));
    out.data[i * 4 + 2] = Math.min(255, Math.max(0, vPass.data[i * 4 + 2] * inv));
    out.data[i * 4 + 3] = Math.min(255, Math.max(0, vPass.data[i * 4 + 3]));
  }
  return out;
}

/** Strict binary alpha (alpha > threshold ? 255 : 0), zeroing RGB of transparent pixels. */
export function applyBinaryAlpha(r: Raster, threshold: number): Raster {
  const out = { w: r.w, h: r.h, data: new Uint8ClampedArray(r.data) };
  for (let i = 0; i < r.w * r.h; i += 1) {
    const keep = out.data[i * 4 + 3] > threshold ? 255 : 0;
    out.data[i * 4 + 3] = keep;
    if (keep === 0) {
      out.data[i * 4] = 0;
      out.data[i * 4 + 1] = 0;
      out.data[i * 4 + 2] = 0;
    }
  }
  return out;
}
