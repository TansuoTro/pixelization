/** Raw RGBA bitmap helpers — everything runs on ImageData, no server needed. */

export interface Raster {
  w: number;
  h: number;
  /** RGBA, length = w * h * 4 */
  data: Uint8ClampedArray;
}

export function blankRaster(w: number, h: number): Raster {
  return { w, h, data: new Uint8ClampedArray(w * h * 4) };
}

export function cloneRaster(r: Raster): Raster {
  return { w: r.w, h: r.h, data: new Uint8ClampedArray(r.data) };
}

export function cropRaster(r: Raster, x0: number, y0: number, x1: number, y1: number): Raster {
  const w = Math.max(1, Math.min(r.w, x1) - Math.max(0, x0));
  const h = Math.max(1, Math.min(r.h, y1) - Math.max(0, y0));
  const out = blankRaster(w, h);
  for (let y = 0; y < h; y += 1) {
    const sy = Math.max(0, y0) + y;
    if (sy >= r.h) break;
    for (let x = 0; x < w; x += 1) {
      const sx = Math.max(0, x0) + x;
      if (sx >= r.w) break;
      const si = (sy * r.w + sx) * 4;
      const di = (y * w + x) * 4;
      out.data[di] = r.data[si];
      out.data[di + 1] = r.data[si + 1];
      out.data[di + 2] = r.data[si + 2];
      out.data[di + 3] = r.data[si + 3];
    }
  }
  return out;
}

export function padToSquare(
  r: Raster,
  mask: Uint8Array,
  fill: [number, number, number]
): { raster: Raster; mask: Uint8Array } {
  const side = Math.max(r.w, r.h, 1);
  if (side === r.w && side === r.h) return { raster: r, mask };
  const out = blankRaster(side, side);
  const outMask = new Uint8Array(side * side).fill(1);
  for (let i = 0; i < side * side; i += 1) {
    out.data[i * 4] = fill[0];
    out.data[i * 4 + 1] = fill[1];
    out.data[i * 4 + 2] = fill[2];
    out.data[i * 4 + 3] = 0;
  }
  const ox = Math.floor((side - r.w) / 2);
  const oy = Math.floor((side - r.h) / 2);
  for (let y = 0; y < r.h; y += 1) {
    for (let x = 0; x < r.w; x += 1) {
      const si = (y * r.w + x) * 4;
      const px = (y + oy) * side + (x + ox);
      const di = px * 4;
      out.data[di] = r.data[si];
      out.data[di + 1] = r.data[si + 1];
      out.data[di + 2] = r.data[si + 2];
      out.data[di + 3] = r.data[si + 3];
      outMask[px] = mask[y * r.w + x];
    }
  }
  return { raster: out, mask: outMask };
}

function toDisplayUrl(src: string): string {
  const s = src.trim();
  if (s.startsWith("data:")) return s;
  if (/^https?:\/\//i.test(s) || s.startsWith("blob:")) return s;
  // Assume raw base64 (provider b64_json or a pasted PNG)
  return `data:image/png;base64,${s}`;
}

function loadImageElement(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (/^https?:\/\//i.test(url)) img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () =>
      reject(
        new Error(
          "无法解码图片。若 provider 返回的是图片 URL，请在设置里改用 b64_json 返回格式或允许跨域的端点。"
        )
      );
    img.src = url;
  });
}

export async function decodeToRaster(src: string): Promise<Raster> {
  const img = await loadImageElement(toDisplayUrl(src));
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  if (!w || !h || w > 4096 || h > 4096 || w * h > 4096 * 4096) {
    throw new Error(`图片尺寸无效或过大：${w}x${h}`);
  }
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("浏览器不支持 Canvas 2D");
  ctx.drawImage(img, 0, 0);
  const id = ctx.getImageData(0, 0, w, h);
  return { w, h, data: id.data };
}

export function rasterToCanvas(r: Raster): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = r.w;
  canvas.height = r.h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("浏览器不支持 Canvas 2D");
  ctx.putImageData(new ImageData(new Uint8ClampedArray(r.data), r.w, r.h), 0, 0);
  return canvas;
}

export function rasterToPngB64(r: Raster): string {
  return rasterToCanvas(r).toDataURL("image/png").split(",")[1] ?? "";
}

export function pngDataUrl(b64: string): string {
  return `data:image/png;base64,${b64}`;
}

export function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.includes(",") ? b64.split(",")[1] : b64;
  const bin = atob(clean);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

export function hexOf(r: number, g: number, b: number): string {
  const h = (v: number) => Math.round(v).toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}

export function fileToBase64(file: File | Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(new Error("读取文件失败"));
    reader.readAsDataURL(file);
  });
}
