import React, { useCallback, useEffect, useRef, useState } from "react";
import { ImagePlus, Upload, X } from "lucide-react";
import { b64DataUrl, CHECKER_STYLE, SliderField } from "./ui";
import { fileToBase64 } from "../core/image";

interface Props {
  b64: string | null;
  name: string | null;
  onB64: (b: string | null) => void;
  onName: (n: string | null) => void;
  strength: number;
  onStrength: (v: number) => void;
  instructions: string;
  onInstructions: (v: string) => void;
  disabled?: boolean;
}

export const ReferenceUpload: React.FC<Props> = ({
  b64,
  name,
  onB64,
  onName,
  strength,
  onStrength,
  instructions,
  onInstructions,
  disabled,
}) => {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragging, setDragging] = useState(false);

  const accept = useCallback(
    async (file: File) => {
      if (!file.type.startsWith("image/")) return;
      if (file.size > 5 * 1024 * 1024) return;
      try {
        const raw = await fileToBase64(file);
        onB64(raw);
        onName(file.name);
      } catch {
        /* ignore decode errors */
      }
    },
    [onB64, onName]
  );

  const clear = useCallback(() => {
    onB64(null);
    onName(null);
    if (inputRef.current) inputRef.current.value = "";
  }, [onB64, onName]);

  useEffect(() => {
    if (disabled) return;
    const onPaste = (e: ClipboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "TEXTAREA" || t.tagName === "INPUT")) return;
      const list = e.clipboardData?.items;
      if (!list) return;
      for (let i = 0; i < list.length; i += 1) {
        const item = list[i];
        if (item.type.startsWith("image/")) {
          const blob = item.getAsFile();
          if (blob) {
            e.preventDefault();
            void accept(new File([blob], `pasted_reference.${item.type.split("/")[1] || "png"}`, { type: item.type }));
            return;
          }
        }
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [accept, disabled]);

  return (
    <div className="space-y-2.5 rounded-xl border border-slate-800 bg-slate-950/40 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-slate-300">
          <ImagePlus className="h-3.5 w-3.5 text-emerald-400" /> 参考图（可选）
        </span>
        {b64 && (
          <button type="button" onClick={clear} className="flex items-center gap-1 text-[10px] text-slate-400 hover:text-rose-300">
            <X className="h-3 w-3" /> 清除
          </button>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/bmp,image/gif"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void accept(f);
          e.target.value = "";
        }}
      />
      {b64 ? (
        <div className="flex items-center gap-3">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-slate-700" style={CHECKER_STYLE}>
            <img src={b64DataUrl(b64)} alt="参考图" className="h-full w-full object-contain" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[11px] text-slate-200">{name}</p>
            <p className="font-mono text-[10px] text-emerald-300">已附加 · 图生图通道</p>
            <button type="button" onClick={() => inputRef.current?.click()} className="mt-1 text-[10px] text-slate-400 underline hover:text-slate-200">替换</button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          disabled={disabled}
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            const f = e.dataTransfer.files?.[0];
            if (f) void accept(f);
          }}
          className={`flex w-full items-center justify-center gap-2 rounded-lg border border-dashed px-3 py-3 text-xs transition ${
            dragging ? "border-emerald-500 bg-emerald-500/5 text-emerald-300" : "border-slate-700 text-slate-400 hover:border-emerald-500/60 hover:text-slate-200"
          } ${disabled ? "cursor-not-allowed opacity-50" : ""}`}
        >
          <Upload className="h-3.5 w-3.5" /> 上传 / 拖放 / Ctrl+V 粘贴参考图
        </button>
      )}
      {b64 && (
        <div className="space-y-2.5 border-t border-slate-800 pt-2.5">
          <SliderField
            label="参考图影响强度"
            value={strength}
            min={0.05}
            max={1}
            step={0.05}
            onChange={onStrength}
            format={(v) => (v >= 0.75 ? `HIGH (${v.toFixed(2)})` : v >= 0.4 ? `MEDIUM (${v.toFixed(2)})` : `LOW (${v.toFixed(2)})`)}
          />
          <div>
            <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-slate-400">参考图补充说明（可选）</label>
            <textarea
              rows={2}
              value={instructions}
              onChange={(e) => onInstructions(e.target.value)}
              placeholder="例如：沿用铜的氧化色调与光照…"
              className="w-full rounded-lg bg-slate-950 border border-slate-800 px-3 py-2 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
            />
          </div>
        </div>
      )}
    </div>
  );
};
