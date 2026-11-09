import type {
  BackgroundMode,
  ProcessParams,
  ResampleMethod,
  SheetStyle,
  TargetSize,
} from "../types";

export const DEFAULT_PROCESS_PARAMS: ProcessParams = {
  grid_rows: 4,
  grid_cols: 4,
  target_size: 16,
  resample: "nearest",
  palette_colors: 24,
  alpha_threshold: 128,
  quantize: true,
  binary_alpha: true,
  background: "auto",
  background_tolerance: 32,
  cell_mode: "item",
  trim: true,
  trim_padding: 0.04,
  cell_inset: 0,
  detect_grid: true,
  contact_sheet_scale: 96,
};

export const SIZES: TargetSize[] = [16, 32, 64];

export const RESAMPLE_LABELS: Record<ResampleMethod, string> = {
  nearest: "Nearest Neighbor（像素画首选）",
  bilinear: "Bilinear（柔和）",
  bicubic: "Bicubic（平滑）",
  lanczos: "Lanczos（高质量缩小）",
  box: "Box（区域平均）",
  hamming: "Hamming（锐利）",
};

export const BACKGROUND_MODE_LABELS: Record<BackgroundMode, string> = {
  auto: "auto（采样四角自动识别）",
  white: "白色色键",
  black: "黑色色键",
  magenta: "品红色键",
  green: "绿色色键",
  transparent: "仅 alpha",
  none: "不去背（整格不透明）",
};

export const STYLE_LABELS: Record<SheetStyle, string> = {
  item: "原版物品图集",
  gtceu: "GTCEu 工业图集",
  faithful: "Faithful（原版++）",
  block: "方块贴图图集",
  machine: "机器六面贴图组",
  animation: "动画帧图集",
  custom: "自定义（仅基础规则）",
};

export const GRID_PRESETS = [
  { label: "2 x 2 (4)", rows: 2, cols: 2 },
  { label: "3 x 3 (9)", rows: 3, cols: 3 },
  { label: "4 x 4 (16)", rows: 4, cols: 4 },
  { label: "4 x 5 (20)", rows: 4, cols: 5 },
  { label: "5 x 5 (25)", rows: 5, cols: 5 },
  { label: "4 x 6 (24)", rows: 4, cols: 6 },
  { label: "6 x 6 (36)", rows: 6, cols: 6 },
];

export const DEFAULT_ITEMS = [
  "Copper ingot",
  "Iron ingot",
  "Gold ingot",
  "Tin ingot",
  "Copper gear",
  "Iron gear",
  "Gold gear",
  "Steel gear",
  "Copper plate",
  "Iron plate",
  "Gold plate",
  "Steel plate",
  "Copper dust",
  "Iron dust",
  "Gold dust",
  "Steel dust",
];

export const GTCEU_STEEL_ITEMS = [
  "Steel ingot",
  "Steel plate",
  "Steel gear",
  "Steel rod",
  "Steel ring",
  "Steel bolt",
  "Steel screw",
  "Steel rotor",
];

export const SHEET_BACKGROUNDS = [
  "white",
  "transparent",
  "black",
  "magenta",
  "green",
] as const;

/**
 * Shortcut suggestions only. These are NOT authoritative — the authoritative
 * list comes from GET /v1/models (or the provider's model list endpoint), and
 * the model field is always freely editable, including for custom endpoints.
 */
export const OPENAI_MODEL_PRESETS = [
  "gpt-image-1",
  "gpt-image-1.5",
  "gpt-image-1-mini",
  "gpt-image-2",
  "gpt-image-2.5",
  "gpt-image-2.5-sunburst",
  "dall-e-3",
];

export const SEEDREAM_MODEL_PRESETS = [
  "doubao-seedream-5-0-260128",
  "doubao-seedream-5-0-lite-260128",
  "doubao-seedream-5-0-pro-260628",
  "doubao-seedream-4-0-250828",
  "doubao-seedream-4-5-251128",
];

export const OPENAI_SIZES = ["1024x1024", "1536x1024", "1024x1536", "auto"];
export const SEEDREAM_SIZES = ["1K", "2K", "4K", "2048x2048", "1024x1024"];

/**
 * Same-origin rewrite paths. Do NOT put https:// URLs in the endpoint field:
 * the browser would call them cross-origin and CORS would reject the request
 * with a bare "Failed to fetch" (no status code at all).
 * Each entry must have a matching [[redirects]] block in netlify.toml and a
 * matching dev proxy in vite.config.ts.
 */
export const ENDPOINT_PRESETS: { label: string; value: string }[] = [
  { label: "OpenAI 官方（/proxy/openai）", value: "/proxy/openai" },
  { label: "SeeDream 方舟（/proxy/ark）", value: "/proxy/ark" },
  { label: "code-tab.com（/proxy/codetab）", value: "/proxy/codetab" },
];
