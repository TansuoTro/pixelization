/**
 * Offline algorithm self-tests for the pure-TypeScript pipeline.
 * No DOM, no network, no AI API calls. Run with: npm run selftest
 */
import { buildBackgroundMask } from "../src/core/background";
import { detectGridLines } from "../src/core/grid";
import { resample, applyBinaryAlpha } from "../src/core/resample";
import { quantizeMedianCut, extractPalette } from "../src/core/quantize";
import { processCell } from "../src/core/sheet";
import {
  buildSheetPrompt,
  buildGridMap,
} from "../src/services/prompts";
import { DEFAULT_PROCESS_PARAMS } from "../src/config/options";
import type { Raster } from "../src/core/image";
import type { ProcessParams, ResampleMethod } from "../src/types";

function assert(cond: unknown, msg: string): void {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exitCode = 1;
    throw new Error(msg);
  }
  console.log("ok  -", msg);
}

// Synthetic 1024x1024 WHITE 4x4 atlas, one coloured square per cell; cell 9 EMPTY;
// each sprite has a WHITE highlight inside that must survive the flood fill.
const W = 1024;
const H = 1024;
const data = new Uint8ClampedArray(W * H * 4);
for (let i = 0; i < W * H; i += 1) {
  data[i * 4] = 255;
  data[i * 4 + 1] = 255;
  data[i * 4 + 2] = 255;
  data[i * 4 + 3] = 255;
}
function rect(x0: number, y0: number, x1: number, y1: number, r: number, g: number, b: number): void {
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const i = (y * W + x) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = 255;
    }
  }
}
for (let r = 0; r < 4; r += 1) {
  for (let c = 0; c < 4; c += 1) {
    if (r === 2 && c === 1) continue; // empty cell 9
    const cx = c * 256 + 128;
    const cy = r * 256 + 128;
    rect(cx - 70, cy - 70, cx + 70, cy + 70, 40 + c * 40, 60 + r * 40, 120);
    rect(cx - 20, cy - 20, cx + 20, cy + 20, 255, 255, 255); // interior white highlight
  }
}
const sheet: Raster = { w: W, h: H, data };
const p: ProcessParams = { ...DEFAULT_PROCESS_PARAMS };

const bg = buildBackgroundMask(sheet, p);
const ratio = bg.mask.reduce((a, v) => a + v, 0) / bg.mask.length;
assert(ratio > 0.55 && ratio < 0.85, `bg mask ratio sane (${ratio.toFixed(3)})`);
assert(bg.mask[(2 * 256 + 128) * W + (1 * 256 + 128)] === 1, "empty cell is background");
assert(bg.mask[(0 * 256 + 128) * W + (0 * 256 + 128)] === 0, "sprite body is content");
assert(bg.mask[(0 * 256 + 128) * W + (0 * 256 + 128)] === 0, "interior white highlight preserved as content");

const gx = detectGridLines(bg.mask, W, H, 4, "x", true);
const gy = detectGridLines(bg.mask, W, H, 4, "y", true);
assert(gx.detected && gy.detected, "grid auto-detected");
assert(
  gx.lines.every((v, i) => Math.abs(v - [0, 256, 512, 768, 1024][i]) <= 2),
  `x lines ${gx.lines}`
);
assert(
  gy.lines.every((v, i) => Math.abs(v - [0, 256, 512, 768, 1024][i]) <= 2),
  `y lines ${gy.lines}`
);

const cw = 256;
const ch = 256;
const cellMask = new Uint8Array(cw * ch).fill(1);
const emptyCell: Raster = { w: cw, h: ch, data: new Uint8ClampedArray(cw * ch * 4) };
const outEmpty = processCell(emptyCell, cellMask, p, [255, 255, 255]);
assert(outEmpty.empty === true, "empty cell flagged");
assert(outEmpty.raster.w === 16 && outEmpty.raster.h === 16, "empty cell resized to 16");

const methods: ResampleMethod[] = ["nearest", "bilinear", "bicubic", "lanczos", "box", "hamming"];
for (const m of methods) {
  const src: Raster = { w: 64, h: 64, data: new Uint8ClampedArray(64 * 64 * 4) };
  for (let i = 0; i < 64 * 64; i += 1) {
    src.data[i * 4] = 200;
    src.data[i * 4 + 1] = 80;
    src.data[i * 4 + 2] = 40;
    src.data[i * 4 + 3] = 255;
  }
  const rs = resample(src, 16, 16, m);
  assert(rs.w === 16 && rs.h === 16 && rs.data.length === 16 * 16 * 4, `resample ${m} shape`);
  assert(rs.data[0] > 100, `resample ${m} keeps colour`);
  const ba = applyBinaryAlpha(rs, 128);
  assert(
    [...new Set(Array.from({ length: 256 }, (_, i) => ba.data[i * 4 + 3]))].every((v) => v === 0 || v === 255),
    `binary alpha ${m}`
  );
}

const qsrc: Raster = { w: 16, h: 16, data: new Uint8ClampedArray(16 * 16 * 4) };
for (let i = 0; i < 256; i += 1) {
  const t = Math.floor(i / 32);
  qsrc.data[i * 4] = t * 30;
  qsrc.data[i * 4 + 1] = 255 - t * 20;
  qsrc.data[i * 4 + 2] = 90;
  qsrc.data[i * 4 + 3] = 255;
}
const q = quantizeMedianCut(qsrc, 4, 128);
assert(extractPalette(q).length <= 4, `MedianCut limits palette (${extractPalette(q).length})`);

const gm = buildGridMap(4, 4);
assert(gm.includes("|") && gm.split("\n").length === 9, "4x4 ASCII grid map");
const prompt = buildSheetPrompt({
  items: ["a", "b", "c", "d"],
  gridRows: 2,
  gridCols: 2,
  style: "gtceu",
  background: "white",
  extraInstructions: "copper tones",
});
assert(
  prompt.includes("MATERIAL LANGUAGE") && prompt.includes("CELL r1c1") && prompt.includes("IMPORTANT:"),
  "prompt assembly"
);
assert(prompt.includes("ADDITIONAL INSTRUCTIONS:"), "extra instructions included");
const custom = buildSheetPrompt({
  items: ["a"],
  gridRows: 1,
  gridCols: 1,
  style: "item",
  background: "white",
  extraInstructions: "",
  customPrompt: "MY BODY",
});
assert(custom.startsWith("MY BODY") && custom.includes("IMPORTANT:"), "custom override keeps fixed rules");
const ref = buildSheetPrompt({
  items: ["a"],
  gridRows: 1,
  gridCols: 1,
  style: "item",
  background: "white",
  extraInstructions: "",
  hasReference: true,
  referenceStrength: 0.9,
  referenceInstructions: "keep copper",
});
assert(ref.includes("REFERENCE IMAGE") && ref.includes("HIGH") && ref.includes("keep copper"), "reference guidance");

console.log("ALL PURE-TS SELFTESTS PASSED");
