/**
 * Sprite-sheet prompt templates (ported 1:1 from the Python backend).
 *
 * Fixed base constraint blocks are ALWAYS appended; the item list, grid
 * geometry, style preset, background and extra instructions are adjustable.
 */
import type { SheetBackground, SheetStyle } from "../types";

interface Preset {
  label: string;
  header: string;
  artStyle: string;
  materialLanguage: string;
  lighting: string;
  cellNote: string;
}

export const STYLE_PRESETS: Record<SheetStyle, Preset> = {
  item: {
    label: "原版物品图集",
    header: "Create a Minecraft Java Edition style pixel art item sprite sheet.",
    artStyle:
      "Authentic Minecraft inventory item texture style.\nStrict pixel art aesthetic.\nCrisp square pixel clusters.\nHard pixel edges, no anti-aliasing.\nLimited color palette.\nConsistent pixel density.\nConsistent lighting and shading.\nSimple readable silhouettes.\nNo photorealism.\nNo 3D rendering.\nNo smooth gradients.",
    materialLanguage:
      "Copper: warm orange and reddish brown.\nIron: neutral gray.\nSteel: dark blue-gray.\nGold: saturated golden yellow.\nTin: pale silvery gray.\nDust/powder forms share the same base hue as their ingot counterpart.",
    lighting:
      "Consistent top-left light source.\nConsistent shading direction.\nConsistent highlight intensity across every cell.",
    cellNote: "one unique item icon per cell, centered",
  },
  gtceu: {
    label: "GTCEu 工业图集",
    header: "Create a professional Minecraft GTCEu-style industrial item sprite atlas.",
    artStyle:
      "Inspired by GregTech CEu and classic Minecraft industrial mod texture design.\nVanilla Minecraft pixel art proportions.\nIndustrial, technical and mechanical appearance.\nStrong readable silhouettes at 16x16 resolution.\nCarefully designed pixel clusters.\nLimited and coherent color palette.\nMetallic highlights and dark pixel shadows.\nConsistent pixel density and object scale.\nNo anti-aliasing.\nNo smooth gradients.\nNo realistic photography.\nNo excessive visual details.",
    materialLanguage:
      "MATERIAL LANGUAGE (keep these colour identities consistent for EVERY item):\nCopper: warm orange and reddish brown.\nIron: neutral gray.\nSteel: dark blue-gray.\nAluminium: pale silver.\nTitanium: cool gray with slight blue tint.\nTungsten: dark charcoal.\nGold: saturated golden yellow.",
    lighting:
      "Consistent top-left light source.\nConsistent shading direction.\nConsistent highlight intensity.",
    cellNote: "one unique industrial item icon per cell, centered",
  },
  faithful: {
    label: "Faithful (Vanilla++ Res)",
    header:
      "Create a Faithful-style Minecraft item sprite sheet: the original vanilla design language kept recognisable but rendered with slightly higher pixel detail.",
    artStyle:
      "Vanilla Minecraft design language, recognisable silhouettes.\nClean pixel art with slightly richer detail than 16x16 vanilla.\nHard pixel edges, no anti-aliasing.\nLimited, coherent color palette.\nConsistent lighting, shading and pixel density.\nNo photorealism, no 3D rendering, no smooth gradients.",
    materialLanguage:
      "Metals keep their canonical Minecraft hues (iron gray, gold yellow, copper orange, diamond cyan).",
    lighting: "Consistent top-left light source and identical highlight strength in every cell.",
    cellNote: "one unique item icon per cell, centered",
  },
  block: {
    label: "方块贴图图集",
    header:
      "Create a Minecraft Java Edition block texture atlas: a grid of seamless, tileable block textures (ore, stone, soil, metal blocks, machine casings).",
    artStyle:
      "Each cell is a full-bleed seamless tileable texture, NOT an item icon.\nNo drop shadows, no object silhouettes, no perspective.\nFlat orthographic 2D pattern that repeats cleanly at every edge.\nStrict pixel art, crisp square pixel clusters, hard edges.\nNo anti-aliasing, no smooth gradients, no photorealism.",
    materialLanguage:
      "Stone/ore share a coherent gray base; metal blocks share a coherent brushed-metal palette; each tile uses a limited palette.",
    lighting: "Flat even lighting inside each tile; no directional cast shadows.",
    cellNote: "one seamless tileable block texture filling the ENTIRE cell",
  },
  machine: {
    label: "机器贴图组",
    header:
      "Create a Minecraft technology-mod machine texture set: the SIX faces of ONE machine (front, back, left, right, top, bottom) plus control-panel detail.",
    artStyle:
      "Every cell is a full-bleed machine face texture, not an item icon.\nThe SAME machine casing material, colour and structure across all faces.\nFront face contains the active panel / interface; other faces are casing.\nStrict pixel art, hard pixel edges, no anti-aliasing.\nNo 3D perspective, no photorealism, no smooth gradients.",
    materialLanguage:
      "Consistent dark blue-gray metal casing with a single accent colour for the active interface; identical screw/rivet detail on every face.",
    lighting: "Flat even lighting; consistent highlight direction on all six faces.",
    cellNote: "one machine face filling the ENTIRE cell",
  },
  animation: {
    label: "动画帧图集",
    header:
      "Create a Minecraft pixel-art animation sprite sheet for a glowing core / flame / electric arc / working-machine effect.",
    artStyle:
      "Each cell is ONE consecutive animation frame, same object, same size, same position within its cell.\nFrames progress smoothly and continuously (no jumps in silhouette or hue).\nStrict pixel art, hard pixel edges, no anti-aliasing.\nLimited coherent palette, no photorealism, no smooth gradients.\nALL cells must be identical in size so frames can be played in order.",
    materialLanguage:
      "One fixed palette for the whole sequence; brightness/energy is the only thing that changes between frames.",
    lighting: "Identical light source in every frame; only the emissive core changes.",
    cellNote: "one animation frame per cell, identical framing and scale",
  },
  custom: {
    label: "自定义（仅基础规则）",
    header: "Create a Minecraft Java Edition style pixel art sprite sheet.",
    artStyle:
      "Strict pixel art, crisp square pixel clusters, hard edges, no anti-aliasing.\nLimited coherent palette, consistent lighting and pixel density.\nNo photorealism, no 3D rendering, no smooth gradients.",
    materialLanguage: "Use one coherent, limited palette across every cell.",
    lighting: "Consistent top-left light source in every cell.",
    cellNote: "one unique sprite per cell, centered",
  },
};

const IMPORTANT_RULES = `IMPORTANT:
- Every cell contains EXACTLY ONE sprite. Do not merge, duplicate or omit any item.
- Maintain a consistent visual language, art style, scale and palette across ALL cells.
- Do NOT draw any text, letters, numbers, labels, captions or cell numbers anywhere.
- Do NOT add a watermark, logo, signature, border frame, drop shadow or decorations.
- Do NOT add a checkerboard, gradient or coloured background behind the sprites.
- The result must look like a professional Minecraft Java Edition mod resource pack asset sheet.`;

const BACKGROUND_BLOCKS: Record<SheetBackground, string> = {
  white:
    "BACKGROUND:\n- Solid PURE WHITE (#FFFFFF) flat background filling EVERY empty area of the image.\n- Uniform white also in the gutters between cells.\n- No shadows outside the sprites, no gradients, no tinted paper, no vignette.",
  transparent:
    "BACKGROUND:\n- Fully transparent background (alpha 0) in every empty area.\n- No shadows outside the sprites, no opaque backdrop.",
  black:
    "BACKGROUND:\n- Solid PURE BLACK (#000000) flat background filling EVERY empty area.\n- No shadows, no gradients, no vignette.",
  magenta:
    "BACKGROUND:\n- Solid PURE MAGENTA (#FF00FF) flat chroma-key background filling EVERY empty area.\n- No shadows, no gradients, no vignette.",
  green:
    "BACKGROUND:\n- Solid PURE GREEN (#00FF00) flat chroma-key background filling EVERY empty area.\n- No shadows, no gradients, no vignette.",
};

function formatTemplate(cols: number, rows: number, n: number): string {
  return `FORMAT:
- A perfectly aligned ${cols} columns x ${rows} rows grid (${n} cells).
- Exactly ${n} individual sprites, one per cell.
- Every cell has IDENTICAL dimensions.
- Each sprite is centered inside its own cell.
- Equal spacing / gutter between all cells.
- No overlapping objects.
- No object extends outside its assigned cell.
- The grid fills the whole image edge to edge.`;
}

function positionLabel(r: number, c: number, rows: number, cols: number): string {
  const vert = r === 1 ? "top" : r === rows ? "bottom" : `row ${r}`;
  const horiz = c === 1 ? "left" : c === cols ? "right" : `column ${c}`;
  if (r === 1 && c === 1) return "TOP-LEFT corner cell";
  if (r === 1 && c === cols) return "TOP-RIGHT corner cell";
  if (r === rows && c === 1) return "BOTTOM-LEFT corner cell";
  if (r === rows && c === cols) return "BOTTOM-RIGHT corner cell";
  if (r === 1) return `top row, ${horiz} from the left`;
  if (r === rows) return `bottom row, ${horiz} from the left`;
  if (c === 1) return `${vert}, left edge cell`;
  if (c === cols) return `${vert}, right edge cell`;
  return `${vert}, ${horiz}`;
}

export function buildGridMap(rows: number, cols: number): string {
  const width = Math.max(3, String(rows * cols).length + 2);
  const center = (s: string) => {
    const left = Math.floor((width - s.length) / 2);
    return " ".repeat(left) + s + " ".repeat(width - s.length - left);
  };
  const bar = "+" + Array(cols).fill("-".repeat(width)).join("+") + "+";
  const lines = [bar];
  for (let r = 0; r < rows; r += 1) {
    const cells = Array.from({ length: cols }, (_, c) => center(String(r * cols + c + 1)));
    lines.push("|" + cells.join("|") + "|", bar);
  }
  return lines.join("\n");
}

export function buildGridAssignment(items: string[], rows: number, cols: number): string {
  return items
    .map((name, idx) => {
      const r = Math.floor(idx / cols) + 1;
      const c = (idx % cols) + 1;
      return `- CELL r${r}c${c} (#${idx + 1}, ${positionLabel(r, c, rows, cols)}) -> "${name}"`;
    })
    .join("\n");
}

export function buildReferenceGuidance(strength: number, instructions: string): string {
  const s = Math.max(0.05, Math.min(1, strength));
  let level = "LOW";
  let rule = "Use only a subtle hint of the reference; prioritise the described items.";
  if (s >= 0.75) {
    level = "HIGH";
    rule = "Follow the reference closely for palette, material language and lighting.";
  } else if (s >= 0.4) {
    level = "MEDIUM";
    rule = "Take moderate inspiration from the reference; keep the listed items recognisable.";
  }
  const lines = [
    "REFERENCE IMAGE (attached to this request as an edit input):",
    `- Reference influence: ${level} (${s.toFixed(2)}).`,
    `- ${rule}`,
    "- Use the reference ONLY as a guide for art style, palette, material language, lighting and pixel density.",
    "- Do NOT copy the reference's composition, layout, text, labels or background into the output.",
    "- Keep the STRICT aligned grid and the EXACT CELL ASSIGNMENT described above.",
    "- Every cell still contains exactly ONE of the listed items on the specified solid background.",
  ];
  if (instructions.trim()) lines.push("- Additional reference guidance:", "  " + instructions.trim());
  return lines.join("\n");
}

export interface BuildPromptOptions {
  items: string[];
  gridRows: number;
  gridCols: number;
  style: SheetStyle;
  background: SheetBackground;
  extraInstructions: string;
  customPrompt?: string;
  hasReference?: boolean;
  referenceStrength?: number;
  referenceInstructions?: string;
}

export function buildSheetPrompt(o: BuildPromptOptions): string {
  const rows = Math.max(1, Math.min(8, Math.trunc(o.gridRows)));
  const cols = Math.max(1, Math.min(8, Math.trunc(o.gridCols)));
  const n = rows * cols;
  const cleaned = o.items.map((i) => String(i).trim()).filter(Boolean);
  const items = (cleaned.length ? cleaned : ["Item"]).slice(0, n);
  while (items.length < n) items.push(`Item ${items.length + 1}`);

  const preset = STYLE_PRESETS[o.style] ?? STYLE_PRESETS.custom;
  let body: string;

  if (o.customPrompt && o.customPrompt.trim()) {
    body = o.customPrompt.trim();
  } else {
    const parts = [
      preset.header,
      "",
      formatTemplate(cols, rows, n),
      "",
      "GRID MAP (row-major, cell numbers refer to the ITEMS list below):",
      buildGridMap(rows, cols),
      "",
      "EXACT CELL ASSIGNMENT (each item MUST appear in its own cell):",
      buildGridAssignment(items, rows, cols),
      "",
      `ITEMS (${n} total, row-major order):`,
      items.map((name, i) => `${i + 1}. ${name}`).join("\n"),
      "",
      "ART STYLE:",
      preset.artStyle,
      "",
      preset.materialLanguage,
      "",
      "LIGHTING:",
      preset.lighting,
      "",
      `CELL CONTENT: ${preset.cellNote}.`,
      "",
      BACKGROUND_BLOCKS[o.background] ?? BACKGROUND_BLOCKS.white,
    ];
    if (o.extraInstructions.trim()) {
      parts.push("", "ADDITIONAL INSTRUCTIONS:", o.extraInstructions.trim());
    }
    body = parts.join("\n");
  }

  if (o.hasReference) {
    body += `\n\n${buildReferenceGuidance(o.referenceStrength ?? 0.75, o.referenceInstructions ?? "")}`;
  }
  // Fixed base rules are always appended, even for a custom override.
  return `${body}\n\n${IMPORTANT_RULES}`;
}

/**
 * Single-texture prompt: identical art-style engine to the atlas prompt but for
 * ONE sprite (no grid, no cell assignment). Reuses the same style presets,
 * background blocks and reference guidance.
 */
const IMPORTANT_RULES_SINGLE = `IMPORTANT:
- This image contains EXACTLY ONE sprite / texture. Do NOT draw a grid, a sheet or multiple objects.
- Keep a consistent visual language, art style, scale and palette.
- Do NOT draw any text, letters, numbers, labels, captions or watermarks.
- Do NOT add a logo, signature, border frame, drop shadow or decorations.
- Do NOT add a checkerboard, gradient or coloured background behind the sprite.
- The result must look like a professional Minecraft Java Edition mod resource pack asset.`;

export interface BuildSinglePromptOptions {
  description: string;
  style: SheetStyle;
  background: SheetBackground;
  extraInstructions: string;
  customPrompt?: string;
  hasReference?: boolean;
  referenceStrength?: number;
  referenceInstructions?: string;
}

export function buildSinglePrompt(o: BuildSinglePromptOptions): string {
  const preset = STYLE_PRESETS[o.style] ?? STYLE_PRESETS.custom;
  let body: string;

  if (o.customPrompt && o.customPrompt.trim()) {
    body = o.customPrompt.trim();
  } else {
    const desc = o.description.trim() || "a single Minecraft sprite icon";
    const parts = [
      preset.header,
      "",
      "SUBJECT (exactly ONE texture, no grid, no sheet):",
      desc,
      "",
      "ART STYLE:",
      preset.artStyle,
      "",
      preset.materialLanguage,
      "",
      "LIGHTING:",
      preset.lighting,
      "",
      `CELL CONTENT: ${preset.cellNote}.`,
      "",
      BACKGROUND_BLOCKS[o.background] ?? BACKGROUND_BLOCKS.white,
    ];
    if (o.extraInstructions.trim()) {
      parts.push("", "ADDITIONAL INSTRUCTIONS:", o.extraInstructions.trim());
    }
    body = parts.join("\n");
  }

  if (o.hasReference) {
    body += `\n\n${buildReferenceGuidance(o.referenceStrength ?? 0.75, o.referenceInstructions ?? "")}`;
  }
  return `${body}\n\n${IMPORTANT_RULES_SINGLE}`;
}
