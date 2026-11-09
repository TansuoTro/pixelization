import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AlertCircle,
  Check,
  Copy,
  Download,
  Eye,
  EyeOff,
  ImagePlus,
  Layers,
  LayoutGrid,
  Package,
  Pin,
  PinOff,
  RefreshCw,
  SlidersHorizontal,
  Sparkles,
  Upload,
  X,
} from "lucide-react";
import {
  buildSheetPrompt,
  downloadDataUrl,
  exportSheetZip,
  fetchSheetOptions,
  generateSheet,
  pngDataUrl,
  processSheet,
} from "../services/api";
import {
  BackgroundMode,
  BuildSheetPromptRequest,
  CellOverrideMap,
  DEFAULT_SHEET_PROCESS,
  GridLines,
  ResampleMethod,
  SheetBackground,
  SheetCell,
  SheetCellMode,
  SheetOptions,
  SheetProcessParams,
  SheetProcessResponse,
  SheetStyle,
  TargetSize,
} from "../types/texture";
import { PixelCanvasEditor } from "./PixelCanvasEditor";

const INPUT_CLS =
  "w-full rounded-lg bg-slate-950 border border-slate-800 px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500";

const CHECKER_STYLE: React.CSSProperties = {
  backgroundImage:
    "linear-gradient(45deg,#2b2b36 25%,transparent 25%)," +
    "linear-gradient(-45deg,#2b2b36 25%,transparent 25%)," +
    "linear-gradient(45deg,transparent 75%,#2b2b36 75%)," +
    "linear-gradient(-45deg,transparent 75%,#2b2b36 75%)",
  backgroundSize: "16px 16px",
  backgroundPosition: "0 0,0 8px,8px -8px,-8px 0",
  backgroundColor: "#1b1b24",
};

const FALLBACK_OPTIONS: SheetOptions = {
  styles: [
    { id: "item", label: "Vanilla Item Sheet" },
    { id: "gtceu", label: "GTCEu Industrial Atlas" },
    { id: "faithful", label: "Faithful (Vanilla++ Res)" },
    { id: "block", label: "Block Texture Atlas" },
    { id: "machine", label: "Machine Texture Set" },
    { id: "animation", label: "Animation Sprite Sheet" },
    { id: "custom", label: "Custom (base rules only)" },
  ],
  resample_methods: {
    nearest: "Nearest Neighbor (crisp pixel art)",
    bilinear: "Bilinear (soft)",
    bicubic: "Bicubic (smooth)",
    lanczos: "Lanczos (high-quality downscale)",
    box: "Box (area average)",
    hamming: "Hamming (sharp-ish)",
  },
  default_items: [
    "Copper ingot", "Iron ingot", "Gold ingot", "Tin ingot",
    "Copper gear", "Iron gear", "Gold gear", "Steel gear",
    "Copper plate", "Iron plate", "Gold plate", "Steel plate",
    "Copper dust", "Iron dust", "Gold dust", "Steel dust",
  ],
  gtceu_steel_items: [
    "Steel ingot", "Steel plate", "Steel gear", "Steel rod",
    "Steel ring", "Steel bolt", "Steel screw", "Steel rotor",
  ],
  backgrounds: ["white", "transparent", "black", "magenta", "green"],
  background_modes: [
    "auto", "white", "black", "magenta", "green",
    "transparent", "none", "rembg",
  ],
  cell_modes: ["item", "block"],
  grid_presets: [
    { label: "2 x 2 (4)", rows: 2, cols: 2 },
    { label: "3 x 3 (9)", rows: 3, cols: 3 },
    { label: "4 x 4 (16)", rows: 4, cols: 4 },
    { label: "4 x 5 (20)", rows: 4, cols: 5 },
    { label: "5 x 5 (25)", rows: 5, cols: 5 },
    { label: "4 x 6 (24)", rows: 4, cols: 6 },
    { label: "6 x 6 (36)", rows: 6, cols: 6 },
  ],
};

const SIZES: TargetSize[] = [16, 32, 64];

function message(err: unknown): string {
  return err instanceof Error ? err.message : "An unexpected error occurred.";
}

// --------------------------------------------------------------------------- //
// Small reusable controls
// --------------------------------------------------------------------------- //

const Field: React.FC<{
  label: string;
  hint?: string;
  children: React.ReactNode;
}> = ({ label, hint, children }) => (
  <div>
    <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5">
      {label}
    </label>
    {children}
    {hint && <p className="mt-1 text-[11px] leading-snug text-slate-500">{hint}</p>}
  </div>
);

const SelectField: React.FC<{
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
  hint?: string;
}> = ({ label, value, options, onChange, hint }) => (
  <Field label={label} hint={hint}>
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={INPUT_CLS}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  </Field>
);

const SliderField: React.FC<{
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  format?: (value: number) => string;
}> = ({ label, value, min, max, step, onChange, format }) => (
  <Field label={format ? `${label} · ${format(value)}` : `${label} · ${value}`}>
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className="w-full accent-emerald-500"
    />
  </Field>
);

const Toggle: React.FC<{
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}> = ({ label, checked, onChange }) => (
  <label className="flex items-center gap-2 cursor-pointer select-none py-1">
    <input
      type="checkbox"
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
      className="w-4 h-4 accent-emerald-500"
    />
    <span className="text-xs text-slate-300">{label}</span>
  </label>
);

const Card: React.FC<{
  title: string;
  icon?: React.ReactNode;
  right?: React.ReactNode;
  children: React.ReactNode;
}> = ({ title, icon, right, children }) => (
  <section className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 shadow-xl">
    <div className="flex items-center justify-between gap-3 mb-4">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-100">
        {icon}
        {title}
      </h2>
      {right}
    </div>
    {children}
  </section>
);

// --------------------------------------------------------------------------- //
// Reusable post-processing controls (global panel AND per-cell override panel)
// --------------------------------------------------------------------------- //

interface PostProcessControlsProps {
  params: SheetProcessParams;
  options: SheetOptions;
  onChange: (params: SheetProcessParams) => void;
  onReset?: () => void;
  /** Grid detection is a whole-atlas property, so it is hidden for single cells. */
  showGridKnobs?: boolean;
}

const PostProcessControls: React.FC<PostProcessControlsProps> = ({
  params,
  options,
  onChange,
  onReset,
  showGridKnobs = true,
}) => {
  const set = <K extends keyof SheetProcessParams>(
    key: K,
    value: SheetProcessParams[K]
  ) => onChange({ ...params, [key]: value });

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-3">
      <Field label="Target resolution">
        <div className="flex gap-1.5">
          {SIZES.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => set("target_size", s)}
              className={`flex-1 text-xs py-2 rounded-lg border transition ${
                params.target_size === s
                  ? "bg-emerald-500/15 border-emerald-500 text-emerald-300"
                  : "bg-slate-950/60 border-slate-800 text-slate-400 hover:border-slate-700"
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </Field>

      <SelectField
        label="Resampling"
        value={params.resample}
        options={Object.entries(options.resample_methods).map(([value, label]) => ({ value, label }))}
        onChange={(v) => set("resample", v as ResampleMethod)}
        hint="Nearest = canonical pixel art. Lanczos/Box useful for noisy AI output."
      />

      <SelectField
        label="Cell mode"
        value={params.cell_mode}
        options={[
          { value: "item", label: "Item (transparent sprite)" },
          { value: "block", label: "Block (opaque full-bleed tile)" },
        ]}
        onChange={(v) => set("cell_mode", v as SheetCellMode)}
      />

      <SelectField
        label="Background removal"
        value={params.background}
        options={options.background_modes.map((b) => ({
          value: b,
          label:
            b === "auto" ? "auto (sample corners)" :
            b === "none" ? "none (keep everything)" :
            b === "rembg" ? "rembg (AI matting)" :
            b === "transparent" ? "alpha only" : `${b} colour key`,
        }))}
        onChange={(v) => set("background", v as BackgroundMode)}
        hint="Border-connected flood fill keeps white highlights inside sprites."
      />

      <SliderField
        label="BG tolerance" value={params.background_tolerance}
        min={0} max={120} step={1}
        onChange={(v) => set("background_tolerance", v)}
        format={(v) => String(v)}
      />
      <SliderField
        label="Cell inset" value={params.cell_inset}
        min={0} max={0.2} step={0.005}
        onChange={(v) => set("cell_inset", v)}
        format={(v) => `${(v * 100).toFixed(1)}%`}
      />
      <SliderField
        label="Palette colours" value={params.palette_colors}
        min={2} max={64} step={1}
        onChange={(v) => set("palette_colors", v)}
      />
      <SliderField
        label="Alpha threshold" value={params.alpha_threshold}
        min={1} max={254} step={1}
        onChange={(v) => set("alpha_threshold", v)}
      />
      <SliderField
        label="Trim padding" value={params.trim_padding}
        min={0} max={0.3} step={0.01}
        onChange={(v) => set("trim_padding", v)}
        format={(v) => `${(v * 100).toFixed(0)}%`}
      />

      <div className="flex flex-col justify-center gap-0.5">
        {showGridKnobs && (
          <Toggle
            label="Auto-detect grid lines"
            checked={params.detect_grid}
            onChange={(v) => set("detect_grid", v)}
          />
        )}
        <Toggle
          label="Trim to content bbox"
          checked={params.trim}
          onChange={(v) => set("trim", v)}
        />
      </div>
      <div className="flex flex-col justify-center gap-0.5">
        <Toggle
          label="MedianCut quantize"
          checked={params.quantize}
          onChange={(v) => set("quantize", v)}
        />
        <Toggle
          label="Binary alpha"
          checked={params.binary_alpha}
          onChange={(v) => set("binary_alpha", v)}
        />
      </div>
      <div className="flex flex-col justify-center">
        {onReset && (
          <button
            type="button"
            onClick={onReset}
            className="text-xs rounded-lg border border-slate-700 bg-slate-950/60 hover:bg-slate-800 text-slate-300 px-3 py-2"
          >
            Reset defaults
          </button>
        )}
      </div>
    </div>
  );
};

// --------------------------------------------------------------------------- //
// Grid overlay for the raw atlas
// --------------------------------------------------------------------------- //

const GridOverlay: React.FC<{
  lines: GridLines;
  width: number;
  height: number;
  show: boolean;
  cols: number;
  rows: number;
}> = ({ lines, width, height, show, cols, rows }) => {
  if (!show || !width || !height) return null;
  const stroke = Math.max(1, width / 500);
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className="absolute inset-0 w-full h-full pointer-events-none"
    >
      {lines.x.map((x, i) => (
        <line
          key={`x-${i}`}
          x1={x} y1={0} x2={x} y2={height}
          stroke="rgba(16,185,129,0.95)" strokeWidth={stroke}
        />
      ))}
      {lines.y.map((y, i) => (
        <line
          key={`y-${i}`}
          x1={0} y1={y} x2={width} y2={y}
          stroke="rgba(16,185,129,0.95)" strokeWidth={stroke}
        />
      ))}
      {Array.from({ length: rows * cols }, (_, idx) => {
        const r = Math.floor(idx / cols);
        const c = idx % cols;
        const cx = (lines.x[c] + lines.x[c + 1]) / 2;
        const cy = (lines.y[r] + lines.y[r + 1]) / 2;
        return (
          <text
            key={`t-${idx}`}
            x={cx} y={cy}
            fill="rgba(16,185,129,0.9)"
            fontSize={Math.max(10, width / 45)}
            textAnchor="middle"
            dominantBaseline="middle"
          >
            {idx + 1}
          </text>
        );
      })}
    </svg>
  );
};

// --------------------------------------------------------------------------- //
// Main studio
// --------------------------------------------------------------------------- //

export const SheetStudio: React.FC = () => {
  const [options, setOptions] = useState<SheetOptions>(FALLBACK_OPTIONS);
  const [itemsText, setItemsText] = useState<string>(
    FALLBACK_OPTIONS.default_items.join("\n")
  );
  const [gridRows, setGridRows] = useState(4);
  const [gridCols, setGridCols] = useState(4);
  const [style, setStyle] = useState<SheetStyle>("item");
  const [background, setBackground] = useState<SheetBackground>("white");
  const [extraInstructions, setExtraInstructions] = useState("");
  const [useCustomPrompt, setUseCustomPrompt] = useState(false);
  const [customPrompt, setCustomPrompt] = useState("");
  const [params, setParams] = useState<SheetProcessParams>(DEFAULT_SHEET_PROCESS);

  const [rawSheetB64, setRawSheetB64] = useState<string | null>(null);
  const [result, setResult] = useState<SheetProcessResponse | null>(null);
  const [wrappedPrompt, setWrappedPrompt] = useState<string | null>(null);
  const [promptPreview, setPromptPreview] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [isReprocessing, setIsReprocessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showOverlay, setShowOverlay] = useState(true);
  const [showContact, setShowContact] = useState(false);
  const [showPrompt, setShowPrompt] = useState(false);
  const [selectedCell, setSelectedCell] = useState<number | null>(null);
  // Per-cell pinned post-processing params. A pinned cell ignores global params
  // entirely until it is unpinned again.
  const [overrides, setOverrides] = useState<CellOverrideMap>({});

  // Optional reference image for img2img generation (GPT Image 2 /images/edits).
  const [referenceB64, setReferenceB64] = useState<string | null>(null);
  const [referencePreviewUrl, setReferencePreviewUrl] = useState<string | null>(null);
  const [referenceName, setReferenceName] = useState<string | null>(null);
  const [referenceStrength, setReferenceStrength] = useState(0.75);
  const [referenceInstructions, setReferenceInstructions] = useState("");
  const [isDraggingReference, setIsDraggingReference] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const referenceInputRef = useRef<HTMLInputElement | null>(null);
  const referenceUrlRef = useRef<string | null>(null);
  const skipReprocessRef = useRef(false);

  const items = useMemo(
    () => itemsText.split("\n").map((s) => s.trim()).filter(Boolean),
    [itemsText]
  );

  useEffect(() => {
    let active = true;
    fetchSheetOptions()
      .then((o) => {
        if (!active) return;
        setOptions(o);
        setItemsText((prev) =>
          prev === FALLBACK_OPTIONS.default_items.join("\n")
            ? o.default_items.join("\n")
            : prev
        );
      })
      .catch(() => {
        /* keep the built-in fallback options */
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(
    () => () => {
      if (referenceUrlRef.current) URL.revokeObjectURL(referenceUrlRef.current);
    },
    []
  );

  const acceptReferenceFile = useCallback((file: File) => {
    if (!file.type.startsWith("image/")) {
      setError("Reference must be an image (PNG / JPEG / WEBP / BMP / GIF).");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError("Reference image is too large (max 5 MB).");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const b64 = String(reader.result).split(",")[1] || "";
      if (!b64) return;
      if (referenceUrlRef.current) URL.revokeObjectURL(referenceUrlRef.current);
      const url = URL.createObjectURL(file);
      referenceUrlRef.current = url;
      setReferencePreviewUrl(url);
      setReferenceB64(b64);
      setReferenceName(file.name);
      setError(null);
      setNotice(
        "Reference image attached — generation will use the GPT Image 2 edits channel."
      );
    };
    reader.readAsDataURL(file);
  }, []);

  const clearReference = useCallback(() => {
    if (referenceUrlRef.current) URL.revokeObjectURL(referenceUrlRef.current);
    referenceUrlRef.current = null;
    setReferencePreviewUrl(null);
    setReferenceB64(null);
    setReferenceName(null);
    if (referenceInputRef.current) referenceInputRef.current.value = "";
  }, []);

  // App's global paste handler is disabled in sheet mode, so the studio owns it.
  // Ignore pastes inside text fields so the item list still pastes normally.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "TEXTAREA" || target.tagName === "INPUT")) {
        return;
      }
      const clipboard = e.clipboardData?.items;
      if (!clipboard) return;
      for (let i = 0; i < clipboard.length; i += 1) {
        const item = clipboard[i];
        if (item.type.startsWith("image/")) {
          const blob = item.getAsFile();
          if (blob) {
            e.preventDefault();
            const ext = (item.type.split("/")[1] || "png").replace("jpeg", "jpg");
            acceptReferenceFile(
              new File([blob], `pasted_reference.${ext}`, { type: item.type })
            );
            return;
          }
        }
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [acceptReferenceFile]);

  const buildPromptPayload = useCallback(
    (): BuildSheetPromptRequest => ({
      items,
      grid_rows: gridRows,
      grid_cols: gridCols,
      style,
      background,
      extra_instructions: extraInstructions,
      custom_prompt: useCustomPrompt ? customPrompt : null,
      has_reference: !!referenceB64,
      reference_strength: referenceStrength,
      reference_instructions: referenceInstructions,
    }),
    [
      items, gridRows, gridCols, style, background, extraInstructions,
      useCustomPrompt, customPrompt, referenceB64, referenceStrength,
      referenceInstructions,
    ]
  );

  // Live prompt preview (no AI call).
  useEffect(() => {
    const timer = window.setTimeout(() => {
      buildSheetPrompt(buildPromptPayload())
        .then((r) => setPromptPreview(r.prompt))
        .catch(() => {
          /* preview is best-effort */
        });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [buildPromptPayload]);

  // REAL-TIME reprocessing: any post-processing change re-splits the stored
  // atlas locally on the backend. It NEVER calls the AI model again.
  useEffect(() => {
    if (!rawSheetB64) return;
    if (skipReprocessRef.current) {
      skipReprocessRef.current = false;
      return;
    }
    const timer = window.setTimeout(async () => {
      setIsReprocessing(true);
      try {
        const response = await processSheet({
          raw_sheet_b64: rawSheetB64,
          items,
          process: params,
          cell_overrides: overrides,
        });
        setResult(response);
      } catch (err) {
        setError(message(err));
      } finally {
        setIsReprocessing(false);
      }
    }, 220);
    return () => window.clearTimeout(timer);
  }, [rawSheetB64, params, items, overrides]);

  const changeGrid = useCallback((rows: number, cols: number) => {
    setGridRows(rows);
    setGridCols(cols);
    setParams((prev) => ({ ...prev, grid_rows: rows, grid_cols: cols }));
  }, []);

  // Seed a newly pinned cell with a COPY of the current global params, so it
  // starts identical and then diverges independently. Grid rows/cols are kept
  // for completeness but the backend always uses global grid detection.
  const pinCell = useCallback(
    (idx: number) => {
      setOverrides((prev) => {
        if (String(idx) in prev) return prev;
        return {
          ...prev,
          [String(idx)]: { ...params, grid_rows: gridRows, grid_cols: gridCols },
        };
      });
    },
    [params, gridRows, gridCols]
  );

  const unpinCell = useCallback((idx: number) => {
    setOverrides((prev) => {
      const next = { ...prev };
      delete next[String(idx)];
      return next;
    });
  }, []);

  const updateOverride = useCallback(
    (idx: number, next: SheetProcessParams) => {
      setOverrides((prev) => ({ ...prev, [String(idx)]: next }));
    },
    []
  );

  const handleGenerate = useCallback(async () => {
    if (isGenerating) return;
    setIsGenerating(true);
    setError(null);
    setNotice(null);
    try {
      const response = await generateSheet({
        items,
        grid_rows: gridRows,
        grid_cols: gridCols,
        style,
        background,
        extra_instructions: extraInstructions,
        custom_prompt: useCustomPrompt ? customPrompt : null,
        provider: "openai",
        process: params,
        reference_image_b64: referenceB64,
        reference_strength: referenceStrength,
        reference_instructions: referenceInstructions,
        cell_overrides: {},
      });
      skipReprocessRef.current = true;
      setRawSheetB64(response.raw_sheet_b64);
      setResult(response);
      setWrappedPrompt(response.wrapped_prompt);
      setSelectedCell(null);
      setOverrides({});
      setNotice(
        `Atlas generated with ${response.provider} — 1 API call produced ` +
          `${response.cells.length} sprites` +
          (response.used_reference
            ? " using the attached reference image (edits channel)."
            : ".")
      );
    } catch (err) {
      setError(message(err));
    } finally {
      setIsGenerating(false);
    }
  }, [
    isGenerating, items, gridRows, gridCols, style, background,
    extraInstructions, customPrompt, useCustomPrompt, params,
    referenceB64, referenceStrength, referenceInstructions,
  ]);

  const handleLoadAtlas = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const b64 = String(reader.result).split(",")[1] || "";
      if (!b64) return;
      skipReprocessRef.current = false;
      setRawSheetB64(b64);
      setResult(null);
      setWrappedPrompt(null);
      setSelectedCell(null);
      setOverrides({});
      setError(null);
      setNotice("Loaded an existing atlas — post-processing runs locally, no API call.");
    };
    reader.readAsDataURL(file);
  }, []);

  const handleZip = useCallback(async () => {
    if (!rawSheetB64) return;
    try {
      const blob = await exportSheetZip({
        raw_sheet_b64: rawSheetB64,
        items,
        process: params,
        cell_overrides: overrides,
      });
      const url = URL.createObjectURL(blob);
      downloadDataUrl(url, "mc_sprite_sheet.zip");
      window.setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch (err) {
      setError(message(err));
    }
  }, [rawSheetB64, items, params, overrides]);

  const handleCopyPrompt = useCallback(() => {
    const text = wrappedPrompt || promptPreview;
    if (text && navigator.clipboard) {
      navigator.clipboard.writeText(text).catch(() => undefined);
      setNotice("Prompt copied to clipboard.");
    }
  }, [wrappedPrompt, promptPreview]);

  const cellModeForEditor = params.cell_mode === "block" ? "block" : "item";
  const selected: SheetCell | null =
    result && selectedCell !== null
      ? result.cells[selectedCell] ?? null
      : null;
  // Local override state is the instant source of truth for the UI; the server
  // response (cell.overridden) catches up after the reprocess debounce.
  const selectedPinned = selected !== null && String(selected.index) in overrides;
  const selectedOverride = selected
    ? overrides[String(selected.index)] ?? null
    : null;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
      {/* ------------------------- LEFT: prompt + knobs ------------------------- */}
      <div className="lg:col-span-4 space-y-6">
        <Card
          title="Atlas Prompt"
          icon={<Sparkles className="w-4 h-4 text-emerald-400" />}
          right={
            <span className="text-[10px] font-mono px-2 py-1 rounded-md bg-emerald-500/10 border border-emerald-500/30 text-emerald-300">
              GPT IMAGE 2
            </span>
          }
        >
          <div className="space-y-4">
            <SelectField
              label="Style preset"
              value={style}
              options={options.styles.map((s) => ({ value: s.id, label: s.label }))}
              onChange={(v) => {
                const next = v as SheetStyle;
                setStyle(next);
                if (next === "block" || next === "machine") {
                  setParams((p) => ({ ...p, cell_mode: "block", trim: false }));
                } else if (next === "animation") {
                  setParams((p) => ({ ...p, cell_mode: "item", trim: false }));
                } else {
                  setParams((p) => ({ ...p, cell_mode: "item", trim: true }));
                }
              }}
              hint="Fixed base constraints + this adjustable style block."
            />

            <Field label={`Grid · ${gridRows} rows x ${gridCols} cols = ${gridRows * gridCols} cells`}>
              <div className="flex flex-wrap gap-1.5">
                {options.grid_presets.map((preset) => (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() => changeGrid(preset.rows, preset.cols)}
                    className={`text-[11px] px-2 py-1 rounded-lg border transition ${
                      gridRows === preset.rows && gridCols === preset.cols
                        ? "bg-emerald-500/15 border-emerald-500 text-emerald-300"
                        : "bg-slate-950/60 border-slate-800 text-slate-400 hover:border-slate-700 hover:text-slate-200"
                    }`}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <input
                  type="number" min={1} max={8} value={gridRows}
                  onChange={(e) => changeGrid(Math.max(1, Math.min(8, Number(e.target.value))), gridCols)}
                  className={INPUT_CLS}
                  aria-label="Grid rows"
                />
                <input
                  type="number" min={1} max={8} value={gridCols}
                  onChange={(e) => changeGrid(gridRows, Math.max(1, Math.min(8, Number(e.target.value))))}
                  className={INPUT_CLS}
                  aria-label="Grid columns"
                />
              </div>
            </Field>

            <Field
              label={`Items (${items.length} entered · ${gridRows * gridCols} cells)`}
              hint="One item per line, row-major. Extra lines are ignored; missing cells are auto-filled."
            >
              <textarea
                rows={9}
                value={itemsText}
                onChange={(e) => setItemsText(e.target.value)}
                className={`${INPUT_CLS} font-mono text-xs leading-relaxed`}
                spellCheck={false}
              />
              <div className="mt-2 flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    setItemsText(options.default_items.join("\n"));
                    changeGrid(4, 4);
                  }}
                  className="text-[11px] bg-slate-800/80 hover:bg-slate-700 text-slate-300 px-2 py-1 rounded-lg border border-slate-700/70"
                >
                  16 vanilla materials
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setItemsText(options.gtceu_steel_items.join("\n"));
                    changeGrid(2, 4);
                  }}
                  className="text-[11px] bg-slate-800/80 hover:bg-slate-700 text-slate-300 px-2 py-1 rounded-lg border border-slate-700/70"
                >
                  8 GTCEu steel parts
                </button>
                <button
                  type="button"
                  onClick={() => setItemsText("")}
                  className="text-[11px] bg-slate-800/80 hover:bg-slate-700 text-slate-400 px-2 py-1 rounded-lg border border-slate-700/70"
                >
                  Clear
                </button>
              </div>
            </Field>

            <SelectField
              label="Atlas background (in prompt)"
              value={background}
              options={options.backgrounds.map((b) => ({ value: b, label: b }))}
              onChange={(v) => setBackground(v as SheetBackground)}
              hint="GPT Image 2 usually renders a WHITE backdrop; the splitter colour-keys it."
            />

            <Field label="Extra instructions (optional)">
              <textarea
                rows={2}
                value={extraInstructions}
                onChange={(e) => setExtraInstructions(e.target.value)}
                placeholder="e.g. keep every ingot exactly 10 pixels wide..."
                className={`${INPUT_CLS} text-xs`}
              />
            </Field>

            <Toggle
              label="Override with a fully custom prompt"
              checked={useCustomPrompt}
              onChange={setUseCustomPrompt}
            />
            {useCustomPrompt && (
              <textarea
                rows={5}
                value={customPrompt}
                onChange={(e) => setCustomPrompt(e.target.value)}
                placeholder="Your full prompt. Fixed base rules are still appended."
                className={`${INPUT_CLS} font-mono text-xs`}
              />
            )}

            <div className="rounded-xl border border-slate-800 bg-slate-950/60">
              <button
                type="button"
                onClick={() => setShowPrompt((v) => !v)}
                className="w-full flex items-center justify-between gap-2 px-3 py-2.5 text-xs font-medium text-slate-300 hover:text-white"
              >
                <span className="flex items-center gap-2">
                  <LayoutGrid className="w-3.5 h-3.5 text-emerald-400" />
                  {wrappedPrompt ? "Prompt actually sent" : "Prompt preview"} ({promptPreview.length} chars)
                </span>
                <span className="flex items-center gap-2">
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleCopyPrompt();
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.stopPropagation();
                        handleCopyPrompt();
                      }
                    }}
                    className="text-slate-400 hover:text-emerald-300"
                    title="Copy prompt"
                  >
                    <Copy className="w-3.5 h-3.5" />
                  </span>
                  {showPrompt ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </span>
              </button>
              {showPrompt && (
                <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words border-t border-slate-800 px-3 py-2.5 text-[10px] leading-relaxed text-slate-400 font-mono">
                  {wrappedPrompt || promptPreview || "Building prompt..."}
                </pre>
              )}
            </div>

            {/* ---------- Optional reference image (img2img / edits) ---------- */}
            <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3 space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <ImagePlus className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-300">
                    Reference image (optional)
                  </span>
                </div>
                {referenceB64 && (
                  <button
                    type="button"
                    onClick={clearReference}
                    className="flex items-center gap-1 text-[10px] text-slate-400 hover:text-rose-300"
                  >
                    <X className="w-3 h-3" /> Clear
                  </button>
                )}
              </div>
              <p className="text-[11px] leading-snug text-slate-500">
                Guides art style / palette / material language via the GPT Image 2{" "}
                <span className="font-mono">/images/edits</span> channel. The strict
                grid rules are always kept. Upload, drop, or{" "}
                <span className="font-mono">Ctrl+V</span> paste an image anywhere.
              </p>

              <input
                ref={referenceInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/bmp,image/gif"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) acceptReferenceFile(file);
                  e.target.value = "";
                }}
              />

              {referenceB64 && referencePreviewUrl ? (
                <div className="flex gap-3 items-center">
                  <div
                    className="w-16 h-16 shrink-0 rounded-lg overflow-hidden border border-slate-700 flex items-center justify-center"
                    style={CHECKER_STYLE}
                  >
                    <img
                      src={referencePreviewUrl}
                      alt="Reference"
                      className="w-full h-full object-contain"
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] text-slate-200 truncate">
                      {referenceName}
                    </p>
                    <p className="text-[10px] text-emerald-300 font-mono mt-0.5">
                      attached · edits channel
                    </p>
                    <button
                      type="button"
                      onClick={() => referenceInputRef.current?.click()}
                      className="mt-1 text-[10px] text-slate-400 hover:text-slate-200 underline"
                    >
                      Replace
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => referenceInputRef.current?.click()}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setIsDraggingReference(true);
                  }}
                  onDragLeave={() => setIsDraggingReference(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setIsDraggingReference(false);
                    const file = e.dataTransfer.files?.[0];
                    if (file) acceptReferenceFile(file);
                  }}
                  className={`flex items-center justify-center gap-2 w-full rounded-lg border border-dashed px-3 py-3 text-xs transition ${
                    isDraggingReference
                      ? "border-emerald-500 bg-emerald-500/5 text-emerald-300"
                      : "border-slate-700 hover:border-emerald-500/60 text-slate-400 hover:text-slate-200"
                  }`}
                >
                  <Upload className="w-3.5 h-3.5" />
                  Upload / drop / paste a reference image
                </button>
              )}

              {referenceB64 && (
                <div className="grid grid-cols-1 gap-2.5 pt-2.5 border-t border-slate-800">
                  <SliderField
                    label="Reference influence"
                    value={referenceStrength}
                    min={0.05}
                    max={1}
                    step={0.05}
                    onChange={setReferenceStrength}
                    format={(v) =>
                      v >= 0.75
                        ? `HIGH (${v.toFixed(2)})`
                        : v >= 0.4
                        ? `MEDIUM (${v.toFixed(2)})`
                        : `LOW (${v.toFixed(2)})`
                    }
                  />
                  <Field label="Reference guidance (optional)">
                    <textarea
                      rows={2}
                      value={referenceInstructions}
                      onChange={(e) => setReferenceInstructions(e.target.value)}
                      placeholder="e.g. match the copper oxidation tones and lighting..."
                      className={`${INPUT_CLS} text-xs`}
                    />
                  </Field>
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={handleGenerate}
              disabled={isGenerating}
              className="w-full flex items-center justify-center gap-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 disabled:cursor-not-allowed px-4 py-3 text-sm font-semibold text-slate-950 transition"
            >
              {isGenerating ? (
                <RefreshCw className="w-4 h-4 animate-spin" />
              ) : (
                <Sparkles className="w-4 h-4" />
              )}
              {isGenerating
                ? "Generating atlas..."
                : `Generate atlas (1 API call, ${gridRows * gridCols} items${referenceB64 ? " + reference" : ""})`}
            </button>

            <div className="border-t border-slate-800 pt-4 space-y-1.5">
              <label className="flex items-center justify-center gap-2 w-full cursor-pointer rounded-xl border border-dashed border-slate-700 hover:border-slate-500 bg-slate-950/40 px-3 py-2.5 text-xs text-slate-400 hover:text-slate-200 transition">
                <Layers className="w-3.5 h-3.5" />
                Load an existing ATLAS to split (no API call)
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/bmp,image/gif"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleLoadAtlas(file);
                    e.target.value = "";
                  }}
                />
              </label>
              <p className="text-[10px] text-slate-500 text-center">
                Different from the reference image above: this skips AI entirely and
                only runs grid splitting + post-processing.
              </p>
            </div>
          </div>
        </Card>
      </div>

      {/* ------------------------- RIGHT: results + knobs ------------------------- */}
      <div className="lg:col-span-8 space-y-6">
        {error && (
          <div role="alert" className="flex items-center justify-between gap-3 rounded-xl bg-rose-950/70 border border-rose-500/50 px-4 py-3 text-sm text-rose-200">
            <div className="flex items-center gap-2.5">
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
              <span>{error}</span>
            </div>
            <button type="button" onClick={() => setError(null)} className="text-xs underline hover:text-white">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}
        {notice && !error && (
          <div className="flex items-center justify-between gap-3 rounded-xl bg-emerald-950/50 border border-emerald-500/40 px-4 py-2.5 text-xs text-emerald-200">
            <span className="flex items-center gap-2">
              <Check className="w-3.5 h-3.5" />
              {notice}
            </span>
            <button type="button" onClick={() => setNotice(null)} className="hover:text-white">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {!rawSheetB64 ? (
          <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-12 flex flex-col items-center justify-center text-center">
            <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 mb-3">
              <Layers className="w-6 h-6" />
            </div>
            <p className="text-sm font-medium text-slate-200">Sprite Sheet Studio</p>
            <p className="text-xs text-slate-400 mt-2 max-w-lg leading-relaxed">
              One prompt renders an entire {gridRows}x{gridCols} atlas. The backend then
              detects the grid on the white backdrop, splits it into cells, and resamples
              each cell to 16/32/64 with your chosen filter. Once the image exists, every
              post-processing knob is live-adjustable without another API call.
            </p>
            <div className="mt-5 flex flex-wrap justify-center gap-2 text-[11px] text-slate-500">
              <span className="px-2 py-1 rounded-lg bg-slate-950 border border-slate-800">Grid detection</span>
              <span className="px-2 py-1 rounded-lg bg-slate-950 border border-slate-800">6 resamplers</span>
              <span className="px-2 py-1 rounded-lg bg-slate-950 border border-slate-800">White / chroma keying</span>
              <span className="px-2 py-1 rounded-lg bg-slate-950 border border-slate-800">Empty-cell check</span>
              <span className="px-2 py-1 rounded-lg bg-slate-950 border border-slate-800">Per-cell PIN overrides</span>
              <span className="px-2 py-1 rounded-lg bg-slate-950 border border-slate-800">ZIP export</span>
            </div>
          </div>
        ) : (
          <>
            <Card
              title="Raw Atlas + Detected Grid"
              icon={<ImagePlus className="w-4 h-4 text-emerald-400" />}
              right={
                <div className="flex items-center gap-2">
                  {result?.grid_lines.detected && (
                    <span className="text-[10px] font-mono px-2 py-1 rounded-md bg-emerald-500/10 border border-emerald-500/30 text-emerald-300">
                      auto-detected
                    </span>
                  )}
                  {isReprocessing && (
                    <span className="flex items-center gap-1 text-[10px] text-amber-300">
                      <RefreshCw className="w-3 h-3 animate-spin" /> reprocessing
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => setShowOverlay((v) => !v)}
                    className="text-xs text-slate-400 hover:text-slate-100 flex items-center gap-1"
                  >
                    {showOverlay ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                    Grid
                  </button>
                  <button
                    type="button"
                    onClick={() => downloadDataUrl(pngDataUrl(rawSheetB64), "mc_raw_atlas.png")}
                    className="text-xs text-slate-400 hover:text-emerald-300 flex items-center gap-1"
                  >
                    <Download className="w-3.5 h-3.5" /> PNG
                  </button>
                </div>
              }
            >
              <div className="relative rounded-xl overflow-hidden border border-slate-800">
                <img
                  src={pngDataUrl(rawSheetB64)}
                  alt="Generated sprite sheet atlas"
                  className="block w-full h-auto"
                />
                {result && (
                  <GridOverlay
                    lines={result.grid_lines}
                    width={result.sheet_width}
                    height={result.sheet_height}
                    show={showOverlay}
                    cols={result.grid_cols}
                    rows={result.grid_rows}
                  />
                )}
              </div>
              <p className="mt-2 text-[11px] text-slate-500">
                {result
                  ? `${result.sheet_width}x${result.sheet_height} source · ${result.grid_rows}x${result.grid_cols} cells · detected boundaries ${result.grid_lines.detected ? "refined onto the white gutters" : "uniform split"}`
                  : "Splitting..."}
              </p>
            </Card>

            <Card
              title="Global Post-Processing (live, no API call)"
              icon={<SlidersHorizontal className="w-4 h-4 text-emerald-400" />}
              right={
                <span className="text-[10px] text-slate-500">
                  {Object.keys(overrides).length > 0
                    ? `${Object.keys(overrides).length} pinned cell(s) keep their own params`
                    : "applies to all unpinned cells"}
                </span>
              }
            >
              <PostProcessControls
                params={params}
                options={options}
                onChange={setParams}
                onReset={() => setParams({ ...DEFAULT_SHEET_PROCESS, grid_rows: gridRows, grid_cols: gridCols })}
              />
              {Object.keys(overrides).length > 0 && (
                <p className="mt-3 text-[11px] text-emerald-300/80">
                  Pinned cells are excluded from these global changes. Unpin a cell
                  (or click its PIN badge) to make it follow the global params again.
                </p>
              )}
            </Card>

            {result && (
              <>
                <Card
                  title={`Processed Cells (${result.cells.length})`}
                  icon={<LayoutGrid className="w-4 h-4 text-emerald-400" />}
                  right={
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] text-slate-500">
                        {Object.keys(overrides).length} pinned ·{" "}
                        {result.cells.filter((c) => c.empty).length} empty / missing
                      </span>
                      <button
                        type="button"
                        onClick={handleZip}
                        className="flex items-center gap-1.5 text-xs bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/40 text-emerald-300 px-2.5 py-1.5 rounded-lg"
                      >
                        <Package className="w-3.5 h-3.5" /> Download all (.zip)
                      </button>
                    </div>
                  }
                >
                  <div
                    className="grid gap-3"
                    style={{ gridTemplateColumns: `repeat(${result.grid_cols}, minmax(0, 1fr))` }}
                  >
                    {result.cells.map((cell) => (
                      <button
                        key={cell.index}
                        type="button"
                        onClick={() => setSelectedCell(cell.index)}
                        className={`text-left rounded-xl border p-2.5 transition ${
                          selectedCell === cell.index
                            ? "border-emerald-500 bg-emerald-500/5"
                            : "border-slate-800 bg-slate-950/50 hover:border-slate-700"
                        }`}
                      >
                        <div
                          className="relative rounded-lg overflow-hidden aspect-square flex items-center justify-center"
                          style={CHECKER_STYLE}
                        >
                          <img
                            src={pngDataUrl(cell.image_b64)}
                            alt={cell.name}
                            className="w-full h-full"
                            style={{ imageRendering: "pixelated" }}
                          />
                          {(cell.overridden || String(cell.index) in overrides) && (
                            <span
                              role="button"
                              tabIndex={0}
                              title="Pinned: this cell uses independent post-processing. Click to unpin."
                              onClick={(e) => {
                                e.stopPropagation();
                                unpinCell(cell.index);
                              }}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  e.stopPropagation();
                                  unpinCell(cell.index);
                                }
                              }}
                              className="absolute top-1 right-1 flex items-center gap-0.5 text-[9px] font-bold px-1.5 py-0.5 rounded bg-emerald-400 text-slate-950 border border-emerald-200 shadow hover:bg-rose-400 hover:border-rose-200"
                            >
                              <Pin className="w-2.5 h-2.5" /> PIN
                            </span>
                          )}
                        </div>
                        <div className="mt-2 flex items-start justify-between gap-1">
                          <div className="min-w-0">
                            <p className="text-[11px] font-medium text-slate-200 truncate">
                              <span className="text-emerald-400 font-mono mr-1">{cell.index + 1}.</span>
                              {cell.name}
                            </p>
                            <p className="text-[10px] text-slate-500 font-mono truncate">
                              r{cell.row + 1}c{cell.col + 1}
                              {(cell.overridden || String(cell.index) in overrides) && (
                                <span className="text-emerald-400"> · independent</span>
                              )}
                            </p>
                          </div>
                          {cell.empty && (
                            <span className="shrink-0 text-[9px] px-1.5 py-0.5 rounded bg-rose-500/15 border border-rose-500/40 text-rose-300">
                              EMPTY
                            </span>
                          )}
                        </div>
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {cell.palette.slice(0, 10).map((hex, i) => (
                            <span
                              key={`${hex}-${i}`}
                              className="w-3 h-3 rounded-sm border border-slate-700"
                              style={{ backgroundColor: hex }}
                              title={hex}
                            />
                          ))}
                        </div>
                        <span
                          role="button"
                          tabIndex={0}
                          onClick={(e) => {
                            e.stopPropagation();
                            downloadDataUrl(pngDataUrl(cell.image_b64), cell.filename);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.stopPropagation();
                              downloadDataUrl(pngDataUrl(cell.image_b64), cell.filename);
                            }
                          }}
                          className="mt-2 inline-flex items-center gap-1 text-[10px] text-slate-400 hover:text-emerald-300"
                        >
                          <Download className="w-3 h-3" /> PNG
                        </span>
                      </button>
                    ))}
                  </div>
                  <p className="mt-3 text-[11px] text-slate-500">
                    Click a cell to open its independent post-processing + pixel editor
                    below. Click the PIN badge to unpin and re-follow global params.
                  </p>
                </Card>

                {selected && (
                  <Card
                    title={`Cell #${selected.index + 1} · ${selected.name} — Independent Post-Processing`}
                    icon={<Pin className="w-4 h-4 text-emerald-400" />}
                    right={
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            selectedPinned
                              ? unpinCell(selected.index)
                              : pinCell(selected.index)
                          }
                          className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border transition ${
                            selectedPinned
                              ? "bg-emerald-500/15 border-emerald-500/50 text-emerald-300 hover:bg-rose-500/10 hover:border-rose-500/40 hover:text-rose-300"
                              : "bg-slate-950/60 border-slate-700 text-slate-300 hover:border-emerald-500/60 hover:text-emerald-300"
                          }`}
                        >
                          {selectedPinned ? (
                            <><PinOff className="w-3.5 h-3.5" /> Unpin (follow global)</>
                          ) : (
                            <><Pin className="w-3.5 h-3.5" /> Pin independent params</>
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() => setSelectedCell(null)}
                          className="text-xs text-slate-400 hover:text-slate-100"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    }
                  >
                    {selectedPinned && selectedOverride ? (
                      <>
                        <p className="mb-3 text-[11px] text-emerald-300/80">
                          This cell is <strong>pinned</strong>: global post-processing
                          changes will NOT affect it. These knobs apply to this cell only.
                          Grid detection stays global (it defines the whole atlas).
                        </p>
                        <PostProcessControls
                          params={selectedOverride}
                          options={options}
                          onChange={(next) => updateOverride(selected.index, next)}
                          onReset={() =>
                            updateOverride(selected.index, {
                              ...DEFAULT_SHEET_PROCESS,
                              grid_rows: gridRows,
                              grid_cols: gridCols,
                            })
                          }
                          showGridKnobs={false}
                        />
                      </>
                    ) : (
                      <p className="text-xs text-slate-400">
                        This cell follows the <strong>global</strong> post-processing
                        params. Click <em>Pin independent params</em> to give it its own
                        copy — it will then keep those settings no matter how the global
                        panel is changed, and a PIN mark will appear on its icon.
                      </p>
                    )}
                    <div className="mt-4 pt-4 border-t border-slate-800 flex items-center justify-between gap-3">
                      <p className="text-[11px] text-slate-500">
                        Saving uses this cell's own processed image
                        {selectedPinned ? " (independent params)" : " (global params)"}.
                      </p>
                      <button
                        type="button"
                        onClick={() =>
                          downloadDataUrl(
                            pngDataUrl(selected.image_b64),
                            selected.filename
                          )
                        }
                        className="flex items-center gap-1.5 text-xs bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold px-3 py-2 rounded-lg shrink-0"
                      >
                        <Download className="w-3.5 h-3.5" /> Save this sprite
                      </button>
                    </div>
                  </Card>
                )}

                {selected && (
                  <Card
                    title={`Pixel Editor · #${selected.index + 1} ${selected.name}`}
                    icon={<Sparkles className="w-4 h-4 text-emerald-400" />}
                    right={
                      <button
                        type="button"
                        onClick={() => setSelectedCell(null)}
                        className="text-xs text-slate-400 hover:text-slate-100"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    }
                  >
                    <PixelCanvasEditor
                      key={selected.index}
                      initialImageB64={selected.image_b64}
                      size={selectedOverride ? selectedOverride.target_size : result.target_size}
                      mode={
                        selectedOverride
                          ? selectedOverride.cell_mode === "block"
                            ? "block"
                            : "item"
                          : cellModeForEditor
                      }
                      palette={selected.palette}
                      onCanvasUpdate={() => undefined}
                    />
                  </Card>
                )}

                <Card
                  title="Contact Sheet Preview"
                  icon={<Eye className="w-4 h-4 text-emerald-400" />}
                  right={
                    <button
                      type="button"
                      onClick={() => setShowContact((v) => !v)}
                      className="text-xs text-slate-400 hover:text-slate-100"
                    >
                      {showContact ? "Hide" : "Show"}
                    </button>
                  }
                >
                  {showContact ? (
                    <img
                      src={pngDataUrl(result.preview_b64)}
                      alt="Contact sheet preview"
                      className="block w-full h-auto rounded-lg border border-slate-800"
                    />
                  ) : (
                    <p className="text-xs text-slate-500">
                      Combined labelled preview of every processed cell, with empty-cell
                      flags and PIN badges for independently tuned cells.
                    </p>
                  )}
                </Card>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default SheetStudio;
