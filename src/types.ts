export type TargetSize = 16 | 32 | 64;

export type ResampleMethod =
  | "nearest"
  | "bilinear"
  | "bicubic"
  | "lanczos"
  | "box"
  | "hamming";

/** `rembg` (ONNX matting) is intentionally absent: it cannot run in a browser. */
export type BackgroundMode =
  | "auto"
  | "white"
  | "black"
  | "magenta"
  | "green"
  | "transparent"
  | "none";

export type SheetCellMode = "item" | "block";

export type SheetBackground =
  | "white"
  | "transparent"
  | "black"
  | "magenta"
  | "green";

export type SheetStyle =
  | "item"
  | "gtceu"
  | "faithful"
  | "block"
  | "machine"
  | "animation"
  | "custom";

export type ProviderId = "openai" | "seedream" | "custom";

/**
 * Explicit connection OPTION. This is a real setting, not inferred from the
 * endpoint string:
 *  - "proxy"  -> same-origin /proxy/* path, relayed by a Netlify rewrite
 *  - "direct" -> absolute https:// URL called straight from the browser
 *                (only works when that endpoint returns CORS headers)
 */
export type ConnectionMode = "proxy" | "direct";

export const CONNECTION_MODE_LABELS: Record<ConnectionMode, string> = {
  proxy: "同源代理 /proxy/*",
  direct: "直连绝对地址 https://",
};

export interface ProcessParams {
  grid_rows: number;
  grid_cols: number;
  target_size: TargetSize;
  resample: ResampleMethod;
  palette_colors: number;
  alpha_threshold: number;
  quantize: boolean;
  binary_alpha: boolean;
  background: BackgroundMode;
  background_tolerance: number;
  cell_mode: SheetCellMode;
  trim: boolean;
  trim_padding: number;
  cell_inset: number;
  detect_grid: boolean;
  contact_sheet_scale: number;
}

export type CellOverrideMap = Record<string, ProcessParams>;

export interface SheetCell {
  index: number;
  row: number;
  col: number;
  name: string;
  filename: string;
  /** raw base64 PNG (no data URL prefix) */
  imageB64: string;
  palette: string[];
  empty: boolean;
  contentRatio: number;
  bbox: number[];
  overridden: boolean;
}

export interface GridLines {
  x: number[];
  y: number[];
  detected: boolean;
}

export interface SheetResult {
  rawSheetB64: string;
  previewB64: string;
  sheetWidth: number;
  sheetHeight: number;
  gridRows: number;
  gridCols: number;
  gridLines: GridLines;
  cells: SheetCell[];
  overriddenIndices: number[];
}

export interface GenerateResult {
  rawSheetB64: string;
  prompt: string;
  provider: ProviderId;
  usedReference: boolean;
}

export interface ProviderConfig {
  /** Which OPTION is active. Drives the default/quick-fill endpoint value. */
  mode: ConnectionMode;
  /** The endpoint actually used for requests (freely editable). */
  endpoint: string;
  /** Absolute https:// endpoint used when mode === "direct". */
  directEndpoint: string;
  /** Same-origin /proxy/* path used when mode === "proxy". */
  proxyEndpoint: string;
  apiKey: string;
  model: string;
  size: string;
  /** SeeDream-only */
  outputFormat?: "png" | "jpeg";
  watermark?: boolean;
}

export interface Settings {
  active: ProviderId;
  openai: ProviderConfig;
  seedream: ProviderConfig;
  custom: ProviderConfig;
  /** Allow the reference image to be sent to the provider. */
  allowReference: boolean;
}
