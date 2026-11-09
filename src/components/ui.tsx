import React from "react";
import {
  BackgroundMode,
  CellOverrideMap,
  ProcessParams,
  ResampleMethod,
  SheetCellMode,
  TargetSize,
} from "../types";
import {
  BACKGROUND_MODE_LABELS,
  DEFAULT_PROCESS_PARAMS,
  RESAMPLE_LABELS,
  SIZES,
} from "../config/options";

export const INPUT_CLS =
  "w-full rounded-lg bg-slate-950 border border-slate-800 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500";

export const Field: React.FC<{
  label: string;
  hint?: string;
  children: React.ReactNode;
}> = ({ label, hint, children }) => (
  <div>
    <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-slate-400">
      {label}
    </label>
    {children}
    {hint && <p className="mt-1 text-[11px] leading-snug text-slate-500">{hint}</p>}
  </div>
);

export const SelectField: React.FC<{
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
  hint?: string;
}> = ({ label, value, options, onChange, hint }) => (
  <Field label={label} hint={hint}>
    <select value={value} onChange={(e) => onChange(e.target.value)} className={INPUT_CLS}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  </Field>
);

export const SliderField: React.FC<{
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
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

export const Toggle: React.FC<{
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}> = ({ label, checked, onChange }) => (
  <label className="flex cursor-pointer select-none items-center gap-2 py-1">
    <input
      type="checkbox"
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
      className="h-4 w-4 accent-emerald-500"
    />
    <span className="text-xs text-slate-300">{label}</span>
  </label>
);

export const Card: React.FC<{
  title: string;
  icon?: React.ReactNode;
  right?: React.ReactNode;
  children: React.ReactNode;
}> = ({ title, icon, right, children }) => (
  <section className="rounded-2xl border border-slate-800 bg-slate-900/90 p-5 shadow-xl">
    <div className="mb-4 flex items-center justify-between gap-3">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-100">
        {icon}
        {title}
      </h2>
      {right}
    </div>
    {children}
  </section>
);

export const CHECKER_STYLE: React.CSSProperties = {
  backgroundImage:
    "linear-gradient(45deg,#2b2b36 25%,transparent 25%)," +
    "linear-gradient(-45deg,#2b2b36 25%,transparent 25%)," +
    "linear-gradient(45deg,transparent 75%,#2b2b36 75%)," +
    "linear-gradient(-45deg,transparent 75%,#2b2b36 75%)",
  backgroundSize: "16px 16px",
  backgroundPosition: "0 0,0 8px,8px -8px,-8px 0",
  backgroundColor: "#1b1b24",
};

export function download(dataUrl: string, filename: string): void {
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

export function b64DataUrl(b64: string): string {
  return `data:image/png;base64,${b64}`;
}

// --------------------------------------------------------------------------- //
// Reusable post-processing controls (global panel + per-cell override panel)
// --------------------------------------------------------------------------- //

interface PostProcessControlsProps {
  params: ProcessParams;
  onChange: (p: ProcessParams) => void;
  onReset?: () => void;
  /** Grid detection is a whole-atlas property, hidden for a single cell. */
  showGridKnobs?: boolean;
}

export const PostProcessControls: React.FC<PostProcessControlsProps> = ({
  params,
  onChange,
  onReset,
  showGridKnobs = true,
}) => {
  const set = <K extends keyof ProcessParams>(key: K, value: ProcessParams[K]) =>
    onChange({ ...params, [key]: value });

  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-3 md:grid-cols-3">
      <Field label="目标分辨率">
        <div className="flex gap-1.5">
          {SIZES.map((s: TargetSize) => (
            <button
              key={s}
              type="button"
              onClick={() => set("target_size", s)}
              className={`flex-1 rounded-lg border py-2 text-xs transition ${
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
        label="重采样方法"
        value={params.resample}
        options={Object.entries(RESAMPLE_LABELS).map(([value, label]) => ({ value, label }))}
        onChange={(v) => set("resample", v as ResampleMethod)}
        hint="Nearest = 原版像素画；Lanczos/Box 适合噪声较多的 AI 输出。"
      />

      <SelectField
        label="格子模式"
        value={params.cell_mode}
        options={[
          { value: "item", label: "物品（透明精灵）" },
          { value: "block", label: "方块（不透明满格）" },
        ]}
        onChange={(v) => set("cell_mode", v as SheetCellMode)}
      />

      <SelectField
        label="背景去除"
        value={params.background}
        options={Object.entries(BACKGROUND_MODE_LABELS).map(([value, label]) => ({ value, label }))}
        onChange={(v) => set("background", v as BackgroundMode)}
        hint="边界连通泛洪，保留精灵内部的同色高光。"
      />

      <SliderField
        label="背景容差"
        value={params.background_tolerance}
        min={0}
        max={120}
        step={1}
        onChange={(v) => set("background_tolerance", v)}
      />
      <SliderField
        label="格子内缩"
        value={params.cell_inset}
        min={0}
        max={0.2}
        step={0.005}
        onChange={(v) => set("cell_inset", v)}
        format={(v) => `${(v * 100).toFixed(1)}%`}
      />
      <SliderField
        label="调色板色数"
        value={params.palette_colors}
        min={2}
        max={64}
        step={1}
        onChange={(v) => set("palette_colors", v)}
      />
      <SliderField
        label="Alpha 阈值"
        value={params.alpha_threshold}
        min={1}
        max={254}
        step={1}
        onChange={(v) => set("alpha_threshold", v)}
      />
      <SliderField
        label="裁切留白"
        value={params.trim_padding}
        min={0}
        max={0.3}
        step={0.01}
        onChange={(v) => set("trim_padding", v)}
        format={(v) => `${(v * 100).toFixed(0)}%`}
      />

      <div className="flex flex-col justify-center gap-0.5">
        {showGridKnobs && (
          <Toggle
            label="自动检测网格线"
            checked={params.detect_grid}
            onChange={(v) => set("detect_grid", v)}
          />
        )}
        <Toggle label="裁切到内容包围盒" checked={params.trim} onChange={(v) => set("trim", v)} />
      </div>
      <div className="flex flex-col justify-center gap-0.5">
        <Toggle label="MedianCut 量化" checked={params.quantize} onChange={(v) => set("quantize", v)} />
        <Toggle label="二值 Alpha" checked={params.binary_alpha} onChange={(v) => set("binary_alpha", v)} />
      </div>
      <div className="flex flex-col justify-center">
        {onReset && (
          <button
            type="button"
            onClick={onReset}
            className="rounded-lg border border-slate-700 bg-slate-950/60 px-3 py-2 text-xs text-slate-300 hover:bg-slate-800"
          >
            重置默认
          </button>
        )}
      </div>
    </div>
  );
};

export function resetParams(rows: number, cols: number): ProcessParams {
  return { ...DEFAULT_PROCESS_PARAMS, grid_rows: rows, grid_cols: cols };
}

export type { CellOverrideMap };
