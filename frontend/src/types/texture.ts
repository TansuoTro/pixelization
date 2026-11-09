export type TextureMode = "item" | "block";

export type TargetSize = 16 | 32 | 64;

export type ProviderId =
  | "upload_only"
  | "mock"
  | "pollinations"
  | "huggingface"
  | "openai"
  | "gemini"
  | "replicate"
  | "fal"
  | "local_sd";

export type EditorTool = "pencil" | "eraser" | "eyedropper";

export interface ProviderInfo {
  id: ProviderId;
  name: string;
  description: string;
  configured: boolean;
  supports_img2img: boolean;
  is_default: boolean;
}

export interface ProvidersResponse {
  default_provider: ProviderId;
  providers: ProviderInfo[];
}

export interface GenerateTextureParams {
  prompt: string;
  mode: TextureMode;
  size: TargetSize;
  provider: ProviderId;
  strength: number;
  paletteColors: number;
  alphaThreshold: number;
  referenceImage: File | null;
}

export interface GenerateResponse {
  processed_image_b64: string;
  raw_image_b64: string;
  wrapped_prompt: string;
  mode: TextureMode;
  size: TargetSize;
  provider: ProviderId;
  palette_colors: number;
  palette: string[];
}

export interface ReprocessParams {
  raw_image_b64: string;
  mode: TextureMode;
  size: TargetSize;
  palette_colors: number;
  alpha_threshold: number;
  strip_background?: boolean;
}

// --------------------------------------------------------------------------- //
// Sprite-sheet / atlas batch studio
// --------------------------------------------------------------------------- //

export type ResampleMethod =
  | "nearest"
  | "bilinear"
  | "bicubic"
  | "lanczos"
  | "box"
  | "hamming";

export type SheetBackground =
  | "white"
  | "transparent"
  | "black"
  | "magenta"
  | "green";

export type BackgroundMode =
  | "auto"
  | "white"
  | "black"
  | "magenta"
  | "green"
  | "transparent"
  | "none"
  | "rembg";

export type SheetStyle =
  | "item"
  | "gtceu"
  | "faithful"
  | "block"
  | "machine"
  | "animation"
  | "custom";

export type SheetCellMode = "item" | "block";

export interface GridPreset {
  label: string;
  rows: number;
  cols: number;
}

export interface SheetOptions {
  styles: { id: string; label: string }[];
  resample_methods: Record<string, string>;
  default_items: string[];
  gtceu_steel_items: string[];
  backgrounds: SheetBackground[];
  background_modes: BackgroundMode[];
  cell_modes: SheetCellMode[];
  grid_presets: GridPreset[];
}

export interface SheetProcessParams {
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

export interface SheetCell {
  index: number;
  row: number;
  col: number;
  name: string;
  filename: string;
  image_b64: string;
  palette: string[];
  empty: boolean;
  content_ratio: number;
  bbox: number[];
  overridden: boolean;
}

export type CellOverrideMap = Record<string, SheetProcessParams>;

export interface GridLines {
  x: number[];
  y: number[];
  detected: boolean;
}

export interface SheetProcessResponse {
  raw_sheet_b64: string;
  preview_b64: string;
  sheet_width: number;
  sheet_height: number;
  grid_rows: number;
  grid_cols: number;
  grid_lines: GridLines;
  cells: SheetCell[];
  resample: ResampleMethod;
  target_size: TargetSize;
  background: BackgroundMode;
  overridden_indices: number[];
}

export interface SheetGenerateResponse extends SheetProcessResponse {
  wrapped_prompt: string;
  provider: ProviderId;
  used_reference: boolean;
}

export interface SheetGenerateRequest {
  items: string[];
  grid_rows: number;
  grid_cols: number;
  style: SheetStyle;
  background: SheetBackground;
  extra_instructions: string;
  custom_prompt?: string | null;
  provider?: ProviderId | null;
  process: SheetProcessParams;
  reference_image_b64?: string | null;
  reference_strength?: number;
  reference_instructions?: string;
  cell_overrides?: CellOverrideMap;
}

export interface SheetProcessRequest {
  raw_sheet_b64: string;
  items: string[];
  process: SheetProcessParams;
  cell_overrides?: CellOverrideMap;
}

export interface BuildSheetPromptRequest {
  items: string[];
  grid_rows: number;
  grid_cols: number;
  style: SheetStyle;
  background: SheetBackground;
  extra_instructions: string;
  custom_prompt?: string | null;
  has_reference?: boolean;
  reference_strength?: number;
  reference_instructions?: string;
}

export interface BuildSheetPromptResponse {
  prompt: string;
  items: string[];
  grid_rows: number;
  grid_cols: number;
  has_reference?: boolean;
}

export const DEFAULT_SHEET_PROCESS: SheetProcessParams = {
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
  cell_inset: 0.0,
  detect_grid: true,
  contact_sheet_scale: 96,
};

