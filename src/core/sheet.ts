/**
 * Sprite-sheet orchestration: split FIRST, then resample each cell.
 * Pure computation on in-memory bitmaps — never calls an AI API.
 */
import type {
  CellOverrideMap,
  GridLines,
  ProcessParams,
  SheetCell,
  SheetResult,
} from "../types";
import { bgSignature, buildBackgroundMask, type BgResult } from "./background";
import { detectGridLines } from "./grid";
import {
  cropRaster,
  decodeToRaster,
  hexOf,
  padToSquare,
  rasterToCanvas,
  rasterToPngB64,
  type Raster,
} from "./image";
import { extractPalette, quantizeMedianCut } from "./quantize";
import { applyBinaryAlpha, resample } from "./resample";
import { zipSync, strToU8 } from "fflate";

export function slugify(name: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") || "sprite"
  );
}

function normalizeNames(names: string[], count: number): string[] {
  const cleaned = names.map((n) => String(n).trim()).filter(Boolean);
  const out = cleaned.slice(0, count);
  while (out.length < count) out.push(`Item ${out.length + 1}`);
  return out;
}

function normalizeOverrides(raw: CellOverrideMap | undefined, count: number): Map<number, ProcessParams> {
  const out = new Map<number, ProcessParams>();
  for (const [key, value] of Object.entries(raw ?? {})) {
    const idx = Number(key);
    if (Number.isInteger(idx) && idx >= 0 && idx < count && value) out.set(idx, value);
  }
  return out;
}

function sliceMask(mask: Uint8Array, w: number, x0: number, y0: number, x1: number, y1: number): Uint8Array {
  const cw = Math.max(1, x1 - x0);
  const ch = Math.max(1, y1 - y0);
  const out = new Uint8Array(cw * ch);
  for (let y = 0; y < ch; y += 1) {
    const sy = y0 + y;
    for (let x = 0; x < cw; x += 1) {
      const sx = x0 + x;
      out[y * cw + x] = sy < 0 || sx < 0 ? 1 : mask[sy * w + sx] ?? 1;
    }
  }
  return out;
}

export interface CellOutcome {
  raster: Raster;
  empty: boolean;
  contentRatio: number;
  bbox: number[];
  palette: string[];
}

export function processCell(
  cell: Raster,
  cellMask: Uint8Array,
  p: ProcessParams,
  bgColor: [number, number, number]
): CellOutcome {
  let r = cell;
  let mask = cellMask;

  if (p.cell_mode === "block") {
    mask = new Uint8Array(cell.w * cell.h); // full-bleed opaque
  }

  let contentCount = 0;
  for (let i = 0; i < mask.length; i += 1) if (!mask[i]) contentCount += 1;
  const contentRatio = mask.length ? contentCount / mask.length : 0;
  const empty = contentRatio < 0.002;

  let bbox = [0, 0, r.w, r.h];
  if (p.trim && p.cell_mode === "item" && contentCount > 0) {
    let minX = r.w;
    let minY = r.h;
    let maxX = -1;
    let maxY = -1;
    for (let y = 0; y < r.h; y += 1) {
      for (let x = 0; x < r.w; x += 1) {
        if (!mask[y * r.w + x]) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX >= 0) {
      const pad = Math.round(Math.max(r.w, r.h) * p.trim_padding);
      minX = Math.max(0, minX - pad);
      minY = Math.max(0, minY - pad);
      maxX = Math.min(r.w, maxX + 1 + pad);
      maxY = Math.min(r.h, maxY + 1 + pad);
      r = cropRaster(r, minX, minY, maxX, maxY);
      mask = sliceMask(mask, cell.w, minX, minY, maxX, maxY);
      bbox = [minX, minY, maxX, maxY];
    }
  }

  // Median of content colours fills the transparent region so filtering does
  // not produce dark halos at the sprite edge.
  let fill: [number, number, number] = bgColor;
  if (contentCount > 0) {
    let s0 = 0;
    let s1 = 0;
    let s2 = 0;
    let n = 0;
    for (let y = 0; y < r.h; y += 1) {
      for (let x = 0; x < r.w; x += 1) {
        const px = y * r.w + x;
        if (px < mask.length && !mask[px]) {
          s0 += r.data[px * 4];
          s1 += r.data[px * 4 + 1];
          s2 += r.data[px * 4 + 2];
          n += 1;
        }
      }
    }
    if (n > 0) fill = [s0 / n, s1 / n, s2 / n];
  }

  const squared = padToSquare(r, mask, fill);
  r = squared.raster;
  mask = squared.mask;

  for (let px = 0; px < r.w * r.h; px += 1) {
    if (mask[px]) {
      r.data[px * 4] = fill[0];
      r.data[px * 4 + 1] = fill[1];
      r.data[px * 4 + 2] = fill[2];
      r.data[px * 4 + 3] = 0;
    } else {
      r.data[px * 4 + 3] = 255;
    }
  }

  let out = resample(r, p.target_size, p.target_size, p.resample);
  if (p.binary_alpha || p.quantize) out = applyBinaryAlpha(out, p.alpha_threshold);
  if (p.quantize) out = quantizeMedianCut(out, p.palette_colors, p.alpha_threshold);

  return { raster: out, empty, contentRatio, bbox, palette: extractPalette(out) };
}

/** Cache the expensive whole-sheet mask; it depends only on pixels + structural params. */
const bgCache = new Map<string, BgResult>();
const BG_CACHE_MAX = 4;

export async function processSheet(
  rawSheetB64: string,
  items: string[],
  params: ProcessParams,
  overrides?: CellOverrideMap
): Promise<SheetResult> {
  const sheet = await decodeToRaster(rawSheetB64);
  const { w: sheetW, h: sheetH } = sheet;
  const rows = params.grid_rows;
  const cols = params.grid_cols;
  const count = rows * cols;
  const names = normalizeNames(items, count);
  const cellOverrides = normalizeOverrides(overrides, count);

  const cacheKey = `${rawSheetB64.length}:${rawSheetB64.slice(0, 64)}:${rawSheetB64.slice(-64)}:${bgSignature(params)}`;
  let globalBg = bgCache.get(cacheKey);
  if (!globalBg) {
    globalBg = buildBackgroundMask(sheet, params);
    if (bgCache.size >= BG_CACHE_MAX) bgCache.clear();
    bgCache.set(cacheKey, globalBg);
  }

  const gx = detectGridLines(globalBg.mask, sheetW, sheetH, cols, "x", params.detect_grid);
  const gy = detectGridLines(globalBg.mask, sheetW, sheetH, rows, "y", params.detect_grid);

  const rasters: Raster[] = [];
  const cells: SheetCell[] = [];

  for (let idx = 0; idx < count; idx += 1) {
    const row = Math.floor(idx / cols);
    const col = idx % cols;
    const cellParams = cellOverrides.get(idx) ?? params;
    const overridden = cellOverrides.has(idx);

    const x0 = gx.lines[col];
    const x1 = gx.lines[col + 1];
    const y0 = gy.lines[row];
    const y1 = gy.lines[row + 1];
    const insetX = Math.floor((x1 - x0) * cellParams.cell_inset);
    const insetY = Math.floor((y1 - y0) * cellParams.cell_inset);
    const cx0 = x0 + insetX;
    const cy0 = y0 + insetY;
    const cx1 = Math.min(sheetW, Math.max(cx0 + 1, x1 - insetX));
    const cy1 = Math.min(sheetH, Math.max(cy0 + 1, y1 - insetY));

    const cellImg = cropRaster(sheet, cx0, cy0, cx1, cy1);
    let cellBg: BgResult;
    if (overridden && bgSignature(cellParams) !== bgSignature(params)) {
      cellBg = buildBackgroundMask(cellImg, cellParams);
    } else {
      cellBg = {
        mask: sliceMask(globalBg.mask, sheetW, cx0, cy0, cx1, cy1),
        color: globalBg.color,
      };
    }

    const outcome = processCell(cellImg, cellBg.mask, cellParams, cellBg.color);
    rasters.push(outcome.raster);
    cells.push({
      index: idx,
      row,
      col,
      name: names[idx],
      filename: `${String(idx + 1).padStart(2, "0")}_${slugify(names[idx])}.png`,
      imageB64: rasterToPngB64(outcome.raster),
      palette: outcome.palette,
      empty: outcome.empty,
      contentRatio: outcome.contentRatio,
      bbox: outcome.bbox,
      overridden,
    });
  }

  const gridLines: GridLines = {
    x: gx.lines,
    y: gy.lines,
    detected: gx.detected && gy.detected,
  };
  const previewB64 = buildContactSheet(rasters, cells, params);
  return {
    rawSheetB64,
    previewB64,
    sheetWidth: sheetW,
    sheetHeight: sheetH,
    gridRows: rows,
    gridCols: cols,
    gridLines,
    cells,
    overriddenIndices: [...cellOverrides.keys()].sort((a, b) => a - b),
  };
}

function buildContactSheet(rasters: Raster[], cells: SheetCell[], p: ProcessParams): string {
  const scale = p.contact_sheet_scale;
  const gap = 8;
  const labelH = 18;
  const width = p.grid_cols * (scale + gap) + gap;
  const height = p.grid_rows * (scale + gap + labelH) + gap;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  ctx.fillStyle = "#12121a";
  ctx.fillRect(0, 0, width, height);

  cells.forEach((cell, idx) => {
    const row = Math.floor(idx / p.grid_cols);
    const col = idx % p.grid_cols;
    const x = gap + col * (scale + gap);
    const y = gap + row * (scale + gap + labelH);

    // Checkerboard so transparency is visible
    for (let ty = 0; ty < scale; ty += 16) {
      for (let tx = 0; tx < scale; tx += 16) {
        ctx.fillStyle = ((tx / 16 + ty / 16) % 2 === 0 ? "#3a3a44" : "#262630");
        ctx.fillRect(x + tx, y + ty, Math.min(16, scale - tx), Math.min(16, scale - ty));
      }
    }
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(rasterToCanvas(rasters[idx]), x, y, scale, scale);
    ctx.strokeStyle = "#5a6478";
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, scale - 1, scale - 1);

    ctx.fillStyle = cell.empty ? "#f87171" : "#cbd5e1";
    ctx.font = "11px ui-sans-serif, system-ui, sans-serif";
    ctx.fillText(`${idx + 1}. ${cell.name}`.slice(0, 26), x, y + scale + 12);
    if (cell.empty) {
      ctx.fillStyle = "#f87171";
      ctx.fillText("EMPTY", x + 4, y + 14);
    }
    if (cell.overridden) {
      ctx.fillStyle = "#10b981";
      ctx.fillRect(x + scale - 30, y + 4, 26, 14);
      ctx.fillStyle = "#061410";
      ctx.font = "bold 9px ui-sans-serif, system-ui, sans-serif";
      ctx.fillText("PIN", x + scale - 27, y + 14);
    }
  });
  return canvas.toDataURL("image/png").split(",")[1] ?? "";
}

export interface SingleResult {
  rawB64: string;
  processedB64: string;
  palette: string[];
  width: number;
  height: number;
  empty: boolean;
  contentRatio: number;
  bbox: number[];
  filename: string;
}

/**
 * Single-texture pipeline: process the WHOLE image as one sprite (no grid
 * splitting). Reuses the same background keying + resample + quantize engine as
 * processCell.
 */
export async function processSingleImage(
  rawB64: string,
  params: ProcessParams,
  name = "texture"
): Promise<SingleResult> {
  const sheet = await decodeToRaster(rawB64);
  const bg = buildBackgroundMask(sheet, params);
  const outcome = processCell(sheet, bg.mask, params, bg.color);
  return {
    rawB64,
    processedB64: rasterToPngB64(outcome.raster),
    palette: outcome.palette,
    width: sheet.w,
    height: sheet.h,
    empty: outcome.empty,
    contentRatio: outcome.contentRatio,
    bbox: outcome.bbox,
    filename: `${slugify(name)}.png`,
  };
}

export function buildSheetZip(result: SheetResult): Uint8Array {
  const files: Record<string, Uint8Array> = {};
  for (const cell of result.cells) {
    const bin = atob(cell.imageB64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
    files[`textures/item/${cell.filename}`] = bytes;
  }
  const manifest = result.cells
    .map(
      (c) =>
        `${String(c.index + 1).padStart(2, "0")} | r${c.row + 1}c${c.col + 1} | ${c.name} | ${c.filename}` +
        (c.overridden ? "  [PINNED]" : "") +
        (c.empty ? "  [EMPTY]" : "")
    )
    .join("\n");
  files["manifest.txt"] = strToU8(manifest + "\n");
  return zipSync(files, { level: 6 });
}

export function hexPaletteOf(r: Raster): string[] {
  return extractPalette(r).map((h) => h || hexOf(0, 0, 0));
}
