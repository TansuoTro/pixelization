import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  Settings2,
  SlidersHorizontal,
  Sparkles,
  X,
} from "lucide-react";
import type {
  CellOverrideMap,
  GridLines,
  ProcessParams,
  Settings,
  SheetBackground,
  SheetCell,
  SheetResult,
  SheetStyle,
} from "../types";
import {
  DEFAULT_ITEMS,
  DEFAULT_PROCESS_PARAMS,
  GRID_PRESETS,
  GTCEU_STEEL_ITEMS,
  SHEET_BACKGROUNDS,
  STYLE_LABELS,
} from "../config/options";
import { PROVIDER_LABELS, isConfigured } from "../config/settings";
import { buildSheetPrompt, type BuildPromptOptions } from "../services/prompts";
import { generateAtlasImage, imageSrcFromB64 } from "../services/providers";
import { buildSheetZip, processSheet } from "../core/sheet";
import { fileToBase64 } from "../core/image";
import {
  b64DataUrl,
  Card,
  CHECKER_STYLE,
  download,
  Field,
  INPUT_CLS,
  PostProcessControls,
  resetParams,
  SelectField,
  Toggle,
} from "./ui";
import { PixelEditor } from "./PixelEditor";
import { ReferenceUpload } from "./ReferenceUpload";
import { SingleStudio } from "./SingleStudio";

interface Props {
  settings: Settings;
  onOpenSettings: () => void;
}

export type StudioMode = "atlas" | "single";

const message = (err: unknown): string =>
  err instanceof Error ? err.message : "发生未知错误";

const GridOverlay: React.FC<{
  lines: GridLines;
  width: number;
  height: number;
  show: boolean;
  cols: number;
  rows: number;
}> = ({ lines, width, height, show, cols, rows }) => {
  if (!show || !width || !height) return null;
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className="pointer-events-none absolute inset-0 h-full w-full"
    >
      {lines.x.map((x, i) => (
        <line key={`x${i}`} x1={x} y1={0} x2={x} y2={height} stroke="rgba(16,185,129,0.95)" strokeWidth={Math.max(1, width / 500)} />
      ))}
      {lines.y.map((y, i) => (
        <line key={`y${i}`} x1={0} y1={y} x2={width} y2={y} stroke="rgba(16,185,129,0.95)" strokeWidth={Math.max(1, height / 500)} />
      ))}
      {Array.from({ length: rows * cols }, (_, idx) => {
        const r = Math.floor(idx / cols);
        const c = idx % cols;
        return (
          <text
            key={`t${idx}`}
            x={(lines.x[c] + lines.x[c + 1]) / 2}
            y={(lines.y[r] + lines.y[r + 1]) / 2}
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

export const SheetStudio: React.FC<Props> = ({ settings, onOpenSettings }) => {
  const [mode, setMode] = useState<StudioMode>("atlas");
  const [itemsText, setItemsText] = useState(DEFAULT_ITEMS.join("\n"));
  const [gridRows, setGridRows] = useState(4);
  const [gridCols, setGridCols] = useState(4);
  const [style, setStyle] = useState<SheetStyle>("item");
  const [background, setBackground] = useState<SheetBackground>("white");
  const [extraInstructions, setExtraInstructions] = useState("");
  const [useCustomPrompt, setUseCustomPrompt] = useState(false);
  const [customPrompt, setCustomPrompt] = useState("");
  const [params, setParams] = useState<ProcessParams>(DEFAULT_PROCESS_PARAMS);
  const [overrides, setOverrides] = useState<CellOverrideMap>({});

  const [referenceB64, setReferenceB64] = useState<string | null>(null);
  const [referenceName, setReferenceName] = useState<string | null>(null);
  const [referenceStrength, setReferenceStrength] = useState(0.75);
  const [referenceInstructions, setReferenceInstructions] = useState("");

  const [rawSheetB64, setRawSheetB64] = useState<string | null>(null);
  const [result, setResult] = useState<SheetResult | null>(null);
  const [wrappedPrompt, setWrappedPrompt] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showOverlay, setShowOverlay] = useState(true);
  const [showContact, setShowContact] = useState(false);
  const [showPrompt, setShowPrompt] = useState(false);
  const [selectedCell, setSelectedCell] = useState<number | null>(null);

  const atlasInputRef = useRef<HTMLInputElement | null>(null);
  const requestSeq = useRef(0);

  const items = useMemo(
    () => itemsText.split("\n").map((s) => s.trim()).filter(Boolean),
    [itemsText]
  );

  const promptPayload = useMemo<BuildPromptOptions>(
    () => ({
      items,
      gridRows,
      gridCols,
      style,
      background,
      extraInstructions,
      customPrompt: useCustomPrompt ? customPrompt : undefined,
      hasReference: !!referenceB64,
      referenceStrength,
      referenceInstructions,
    }),
    [items, gridRows, gridCols, style, background, extraInstructions, useCustomPrompt, customPrompt, referenceB64, referenceStrength, referenceInstructions]
  );

  const promptPreview = useMemo(() => buildSheetPrompt(promptPayload), [promptPayload]);

  // ---------- real-time local reprocessing (NO API call) ----------
  useEffect(() => {
    if (!rawSheetB64) return;
    const seq = ++requestSeq.current;
    const timer = window.setTimeout(async () => {
      setIsProcessing(true);
      try {
        const next = await processSheet(
          rawSheetB64,
          items,
          { ...params, grid_rows: gridRows, grid_cols: gridCols },
          overrides
        );
        if (seq === requestSeq.current) setResult(next);
      } catch (err) {
        if (seq === requestSeq.current) setError(message(err));
      } finally {
        if (seq === requestSeq.current) setIsProcessing(false);
      }
    }, 200);
    return () => window.clearTimeout(timer);
  }, [rawSheetB64, params, gridRows, gridCols, items, overrides]);

  const changeGrid = useCallback((rows: number, cols: number) => {
    setGridRows(rows);
    setGridCols(cols);
    setParams((p) => ({ ...p, grid_rows: rows, grid_cols: cols }));
  }, []);

  const pinCell = useCallback(
    (idx: number) => {
      setOverrides((prev) => {
        if (String(idx) in prev) return prev;
        return { ...prev, [String(idx)]: { ...params, grid_rows: gridRows, grid_cols: gridCols } };
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

  const updateOverride = useCallback((idx: number, next: ProcessParams) => {
    setOverrides((prev) => ({ ...prev, [String(idx)]: next }));
  }, []);

  const handleGenerate = useCallback(async () => {
    if (isGenerating) return;
    if (!isConfigured(settings)) {
      setError("请先在「设置」里填好所选 Provider 的 API Key（自定义端点还需地址与 model）。");
      onOpenSettings();
      return;
    }
    setIsGenerating(true);
    setError(null);
    setNotice(null);
    try {
      const b64 = await generateAtlasImage({
        settings,
        prompt: promptPreview,
        referenceB64: settings.allowReference ? referenceB64 : null,
      });
      const seq = ++requestSeq.current;
      setIsProcessing(true);
      const next = await processSheet(
        b64,
        items,
        { ...params, grid_rows: gridRows, grid_cols: gridCols },
        {}
      );
      if (seq !== requestSeq.current) return;
      setRawSheetB64(b64);
      setResult(next);
      setWrappedPrompt(promptPreview);
      setSelectedCell(null);
      setOverrides({});
      setNotice(
        `已用 ${PROVIDER_LABELS[settings.active]} 生成图集（1 次 API 调用 → ${next.cells.length} 个精灵）` +
          (settings.allowReference && referenceB64 ? "，含参考图。" : "。")
      );
    } catch (err) {
      setError(message(err));
    } finally {
      setIsGenerating(false);
      setIsProcessing(false);
    }
  }, [
    isGenerating, settings, promptPreview, referenceB64, items, params,
    gridRows, gridCols, onOpenSettings,
  ]);

  const handleLoadAtlas = useCallback(async (file: File) => {
    try {
      const b64 = await fileToBase64(file);
      ++requestSeq.current;
      setRawSheetB64(b64);
      setResult(null);
      setWrappedPrompt(null);
      setSelectedCell(null);
      setOverrides({});
      setError(null);
      setNotice("已载入已有图集，后续只做本地分割与后处理，不会请求 API。");
    } catch (err) {
      setError(message(err));
    }
  }, []);

  const handleZip = useCallback(async () => {
    if (!rawSheetB64) return;
    try {
      const next = await processSheet(
        rawSheetB64,
        items,
        { ...params, grid_rows: gridRows, grid_cols: gridCols },
        overrides
      );
      const bytes = buildSheetZip(next);
      const blob = new Blob([bytes as BlobPart], { type: "application/zip" });
      const url = URL.createObjectURL(blob);
      download(url, "mc_sprite_sheet.zip");
      window.setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch (err) {
      setError(message(err));
    }
  }, [rawSheetB64, items, params, gridRows, gridCols, overrides]);

  const selected: SheetCell | null =
    result && selectedCell !== null ? result.cells[selectedCell] ?? null : null;
  const selectedPinned = selected !== null && String(selected.index) in overrides;
  const selectedOverride = selected ? overrides[String(selected.index)] ?? null : null;

  const ready = isConfigured(settings);

  const renderModeTabs = () => (
    <div className="mb-6 flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-900/80 p-1.5">
      {([
        { id: "atlas", label: "图集模式（多格切分）" },
        { id: "single", label: "单图贴图模式（不切分）" },
      ] as { id: StudioMode; label: string }[]).map((tab) => (
        <button
          key={tab.id}
          type="button"
          onClick={() => setMode(tab.id)}
          className={`flex-1 rounded-lg px-4 py-2 text-xs font-medium transition ${
            mode === tab.id
              ? "bg-emerald-500 text-slate-950"
              : "text-slate-400 hover:text-slate-100"
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );

  if (mode === "single") {
    return (
      <>
        {renderModeTabs()}
        <SingleStudio settings={settings} onOpenSettings={onOpenSettings} />
      </>
    );
  }

  return (
    <>
      {renderModeTabs()}
      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-12">
      {/* LEFT --------------------------------------------------------------- */}
      <div className="space-y-6 lg:col-span-4">
        <Card
          title="图集 Prompt"
          icon={<Sparkles className="h-4 w-4 text-emerald-400" />}
          right={
            <button
              type="button"
              onClick={onOpenSettings}
              className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-950/60 px-2.5 py-1.5 text-[11px] text-slate-300 hover:border-emerald-500/60 hover:text-emerald-300"
            >
              <Settings2 className="h-3.5 w-3.5" />
              {PROVIDER_LABELS[settings.active]}
            </button>
          }
        >
          <div className="space-y-4">
            <div className={`rounded-lg border px-3 py-2 text-[11px] ${ready ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-300" : "border-amber-500/40 bg-amber-500/5 text-amber-200"}`}>
              {ready
                ? `已配置 · ${PROVIDER_LABELS[settings.active]} · ${settings[settings.active].model || "未填 model"} · ${settings[settings.active].mode === "direct" ? "直连" : "代理"}`
                : "未配置 API Key — 点右上角「设置」填写（也可先载入已有图集离线体验）"}
            </div>

            <SelectField
              label="风格预设"
              value={style}
              options={(Object.keys(STYLE_LABELS) as SheetStyle[]).map((s) => ({ value: s, label: STYLE_LABELS[s] }))}
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
            />

            <Field label={`网格 · ${gridRows} 行 x ${gridCols} 列 = ${gridRows * gridCols} 格`}>
              <div className="flex flex-wrap gap-1.5">
                {GRID_PRESETS.map((preset) => (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() => changeGrid(preset.rows, preset.cols)}
                    className={`rounded-lg border px-2 py-1 text-[11px] transition ${
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
                <input type="number" min={1} max={8} value={gridRows} aria-label="行数" onChange={(e) => changeGrid(Math.max(1, Math.min(8, Number(e.target.value))), gridCols)} className={INPUT_CLS} />
                <input type="number" min={1} max={8} value={gridCols} aria-label="列数" onChange={(e) => changeGrid(gridRows, Math.max(1, Math.min(8, Number(e.target.value))))} className={INPUT_CLS} />
              </div>
            </Field>

            <Field label={`物品清单（已填 ${items.length} · 网格 ${gridRows * gridCols} 格）`} hint="每行一个，按行优先排列；多出的忽略，不足自动补位。">
              <textarea
                rows={9}
                value={itemsText}
                onChange={(e) => setItemsText(e.target.value)}
                spellCheck={false}
                className={`${INPUT_CLS} font-mono text-xs leading-relaxed`}
              />
              <div className="mt-2 flex flex-wrap gap-1.5">
                <button type="button" onClick={() => { setItemsText(DEFAULT_ITEMS.join("\n")); changeGrid(4, 4); }} className="rounded-lg border border-slate-700/70 bg-slate-800/80 px-2 py-1 text-[11px] text-slate-300 hover:bg-slate-700">
                  16 个原版材料
                </button>
                <button type="button" onClick={() => { setItemsText(GTCEU_STEEL_ITEMS.join("\n")); changeGrid(2, 4); }} className="rounded-lg border border-slate-700/70 bg-slate-800/80 px-2 py-1 text-[11px] text-slate-300 hover:bg-slate-700">
                  8 个 GTCEu 钢件
                </button>
                <button type="button" onClick={() => setItemsText("")} className="rounded-lg border border-slate-700/70 bg-slate-800/80 px-2 py-1 text-[11px] text-slate-400 hover:bg-slate-700">
                  清空
                </button>
              </div>
            </Field>

            <SelectField
              label="图集背景（写入 prompt）"
              value={background}
              options={SHEET_BACKGROUNDS.map((b) => ({ value: b, label: b }))}
              onChange={(v) => setBackground(v as SheetBackground)}
              hint="GPT Image / SeeDream 通常输出白底，分割器会做色键去除。"
            />

            <Field label="附加指令（可选）">
              <textarea rows={2} value={extraInstructions} onChange={(e) => setExtraInstructions(e.target.value)} placeholder="例如：每个锭保持 10 像素宽…" className={`${INPUT_CLS} text-xs`} />
            </Field>

            <Toggle label="用完全自定义 Prompt 覆盖" checked={useCustomPrompt} onChange={setUseCustomPrompt} />
            {useCustomPrompt && (
              <textarea rows={5} value={customPrompt} onChange={(e) => setCustomPrompt(e.target.value)} placeholder="你的完整 prompt，固定基础规则仍会追加。" className={`${INPUT_CLS} font-mono text-xs`} />
            )}

            {/* Reference image */}
            <ReferenceUpload
              b64={referenceB64}
              name={referenceName}
              onB64={setReferenceB64}
              onName={setReferenceName}
              strength={referenceStrength}
              onStrength={setReferenceStrength}
              instructions={referenceInstructions}
              onInstructions={setReferenceInstructions}
            />

            {/* Prompt preview */}
            <div className="rounded-xl border border-slate-800 bg-slate-950/60">
              <div className="flex items-center justify-between gap-2 px-3 py-2.5">
                <button type="button" onClick={() => setShowPrompt((v) => !v)} className="flex items-center gap-2 text-xs font-medium text-slate-300 hover:text-white">
                  <LayoutGrid className="h-3.5 w-3.5 text-emerald-400" />
                  {wrappedPrompt ? "实际发送的 Prompt" : "Prompt 预览"}（{promptPreview.length} 字符）
                </button>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => { void navigator.clipboard?.writeText(wrappedPrompt || promptPreview); setNotice("Prompt 已复制"); }} className="text-slate-400 hover:text-emerald-300" title="复制">
                    <Copy className="h-3.5 w-3.5" />
                  </button>
                  <button type="button" onClick={() => setShowPrompt((v) => !v)} className="text-slate-400 hover:text-slate-100">
                    {showPrompt ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  </button>
                </div>
              </div>
              {showPrompt && (
                <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words border-t border-slate-800 px-3 py-2.5 font-mono text-[10px] leading-relaxed text-slate-400">
                  {wrappedPrompt || promptPreview}
                </pre>
              )}
            </div>

            <button
              type="button"
              onClick={() => void handleGenerate()}
              disabled={isGenerating}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 px-4 py-3 text-sm font-semibold text-slate-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isGenerating ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              {isGenerating ? "正在生成图集…" : `生成图集（1 次 API 调用 · ${gridRows * gridCols} 个物品）`}
            </button>

            <div className="space-y-1.5 border-t border-slate-800 pt-4">
              <input
                ref={atlasInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/bmp,image/gif"
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleLoadAtlas(f); e.target.value = ""; }}
              />
              <button
                type="button"
                onClick={() => atlasInputRef.current?.click()}
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-slate-700 bg-slate-950/40 px-3 py-2.5 text-xs text-slate-400 transition hover:border-slate-500 hover:text-slate-200"
              >
                <Layers className="h-3.5 w-3.5" /> 载入已有图集（完全离线，不请求 API）
              </button>
              <p className="text-center text-[10px] text-slate-500">与上方「参考图」不同：这条路径跳过 AI，只跑网格分割与后处理。</p>
            </div>
          </div>
        </Card>
      </div>

      {/* RIGHT -------------------------------------------------------------- */}
      <div className="space-y-6 lg:col-span-8">
        {error && (
          <div role="alert" className="flex items-center justify-between gap-3 rounded-xl border border-rose-500/50 bg-rose-950/70 px-4 py-3 text-sm text-rose-200">
            <div className="flex items-center gap-2.5"><AlertCircle className="h-4 w-4 shrink-0 text-rose-400" /><span>{error}</span></div>
            <button type="button" onClick={() => setError(null)} className="text-xs underline hover:text-white"><X className="h-4 w-4" /></button>
          </div>
        )}
        {notice && !error && (
          <div className="flex items-center justify-between gap-3 rounded-xl border border-emerald-500/40 bg-emerald-950/50 px-4 py-2.5 text-xs text-emerald-200">
            <span className="flex items-center gap-2"><Check className="h-3.5 w-3.5" />{notice}</span>
            <button type="button" onClick={() => setNotice(null)} className="hover:text-white"><X className="h-3.5 w-3.5" /></button>
          </div>
        )}

        {!rawSheetB64 ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-slate-800 bg-slate-900/90 p-12 text-center">
            <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl border border-emerald-500/30 bg-emerald-500/10 text-emerald-400"><Layers className="h-6 w-6" /></div>
            <p className="text-sm font-medium text-slate-200">Sprite Sheet Studio · 纯浏览器版</p>
            <p className="mt-2 max-w-lg text-xs leading-relaxed text-slate-400">
              一次 Prompt 渲染整张 {gridRows}×{gridCols} 图集 → 浏览器内检测网格、按格切分、逐格重采样到 16/32/64。
              图出来之后所有后处理参数实时可调，<strong>不会再请求 API</strong>。
            </p>
            <div className="mt-5 flex flex-wrap justify-center gap-2 text-[11px] text-slate-500">
              {["OpenAI / GPT Image", "SeeDream 火山方舟", "自定义 OAI 端点", "网格检测", "6 种采样", "白底/色键", "空格检测", "单格 PIN 覆盖", "ZIP 导出"].map((t) => (
                <span key={t} className="rounded-lg border border-slate-800 bg-slate-950 px-2 py-1">{t}</span>
              ))}
            </div>
          </div>
        ) : (
          <>
            <Card
              title="原始图集 + 检测网格"
              icon={<ImagePlus className="h-4 w-4 text-emerald-400" />}
              right={
                <div className="flex items-center gap-2">
                  {result?.gridLines.detected && <span className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 font-mono text-[10px] text-emerald-300">auto-detected</span>}
                  {isProcessing && <span className="flex items-center gap-1 text-[10px] text-amber-300"><RefreshCw className="h-3 w-3 animate-spin" /> 处理中</span>}
                  <button type="button" onClick={() => setShowOverlay((v) => !v)} className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-100">
                    {showOverlay ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />} 网格
                  </button>
                  <button type="button" onClick={() => download(imageSrcFromB64(rawSheetB64), "mc_raw_atlas.png")} className="flex items-center gap-1 text-xs text-slate-400 hover:text-emerald-300">
                    <Download className="h-3.5 w-3.5" /> PNG
                  </button>
                </div>
              }
            >
              <div className="relative overflow-hidden rounded-xl border border-slate-800">
                <img src={imageSrcFromB64(rawSheetB64)} alt="生成的图集" className="block h-auto w-full" />
                {result && <GridOverlay lines={result.gridLines} width={result.sheetWidth} height={result.sheetHeight} show={showOverlay} cols={result.gridCols} rows={result.gridRows} />}
              </div>
              <p className="mt-2 text-[11px] text-slate-500">
                {result
                  ? `${result.sheetWidth}x${result.sheetHeight} 源图 · ${result.gridRows}x${result.gridCols} 格 · ${result.gridLines.detected ? "边界已吸附到白色间隔" : "均匀切分"}`
                  : "正在切分…"}
              </p>
            </Card>

            <Card
              title="全局后处理（实时，不请求 API）"
              icon={<SlidersHorizontal className="h-4 w-4 text-emerald-400" />}
              right={
                <span className="text-[10px] text-slate-500">
                  {Object.keys(overrides).length > 0 ? `${Object.keys(overrides).length} 个已固定格子保持独立参数` : "作用于所有未固定格子"}
                </span>
              }
            >
              <PostProcessControls params={params} onChange={setParams} onReset={() => setParams(resetParams(gridRows, gridCols))} />
              {Object.keys(overrides).length > 0 && (
                <p className="mt-3 text-[11px] text-emerald-300/80">已固定的格子不受这里的全局改动影响；点击格子上的 PIN 标记取消固定后才会重新跟随全局。</p>
              )}
            </Card>

            {result && (
              <>
                <Card
                  title={`处理后的格子（${result.cells.length}）`}
                  icon={<LayoutGrid className="h-4 w-4 text-emerald-400" />}
                  right={
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] text-slate-500">{Object.keys(overrides).length} 固定 · {result.cells.filter((c) => c.empty).length} 空格</span>
                      <button type="button" onClick={() => void handleZip()} className="flex items-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/15 px-2.5 py-1.5 text-xs text-emerald-300 hover:bg-emerald-500/25">
                        <Package className="h-3.5 w-3.5" /> 下载全部 (.zip)
                      </button>
                    </div>
                  }
                >
                  <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${result.gridCols}, minmax(0, 1fr))` }}>
                    {result.cells.map((cell) => {
                      const pinned = cell.overridden || String(cell.index) in overrides;
                      return (
                        <button
                          key={cell.index}
                          type="button"
                          onClick={() => setSelectedCell(cell.index)}
                          className={`rounded-xl border p-2.5 text-left transition ${
                            selectedCell === cell.index ? "border-emerald-500 bg-emerald-500/5" : "border-slate-800 bg-slate-950/50 hover:border-slate-700"
                          }`}
                        >
                          <div className="relative flex aspect-square items-center justify-center overflow-hidden rounded-lg" style={CHECKER_STYLE}>
                            <img src={b64DataUrl(cell.imageB64)} alt={cell.name} className="pixelated h-full w-full" style={{ imageRendering: "pixelated" }} />
                            {pinned && (
                              <span
                                role="button"
                                tabIndex={0}
                                title="已固定：使用独立后处理参数。点击取消固定。"
                                onClick={(e) => { e.stopPropagation(); unpinCell(cell.index); }}
                                onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); unpinCell(cell.index); } }}
                                className="absolute right-1 top-1 flex items-center gap-0.5 rounded border border-emerald-200 bg-emerald-400 px-1.5 py-0.5 text-[9px] font-bold text-slate-950 shadow hover:bg-rose-400 hover:border-rose-200"
                              >
                                <Pin className="h-2.5 w-2.5" /> PIN
                              </span>
                            )}
                          </div>
                          <div className="mt-2 flex items-start justify-between gap-1">
                            <div className="min-w-0">
                              <p className="truncate text-[11px] font-medium text-slate-200">
                                <span className="mr-1 font-mono text-emerald-400">{cell.index + 1}.</span>{cell.name}
                              </p>
                              <p className="truncate font-mono text-[10px] text-slate-500">
                                r{cell.row + 1}c{cell.col + 1}{pinned && <span className="text-emerald-400"> · 独立</span>}
                              </p>
                            </div>
                            {cell.empty && <span className="shrink-0 rounded border border-rose-500/40 bg-rose-500/15 px-1.5 py-0.5 text-[9px] text-rose-300">空</span>}
                          </div>
                          <div className="mt-1.5 flex flex-wrap gap-1">
                            {cell.palette.slice(0, 10).map((hex, i) => (
                              <span key={`${hex}-${i}`} title={hex} className="h-3 w-3 rounded-sm border border-slate-700" style={{ backgroundColor: hex }} />
                            ))}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                  <p className="mt-3 text-[11px] text-slate-500">点击格子打开独立后处理与像素编辑器；点击 PIN 标记取消固定。</p>
                </Card>

                {selected && (
                  <Card
                    title={`格子 #${selected.index + 1} · ${selected.name} — 独立后处理`}
                    icon={<Pin className="h-4 w-4 text-emerald-400" />}
                    right={
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => (selectedPinned ? unpinCell(selected.index) : pinCell(selected.index))}
                          className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs transition ${
                            selectedPinned ? "border-emerald-500/50 bg-emerald-500/15 text-emerald-300 hover:border-rose-500/40 hover:bg-rose-500/10 hover:text-rose-300" : "border-slate-700 bg-slate-950/60 text-slate-300 hover:border-emerald-500/60 hover:text-emerald-300"
                          }`}
                        >
                          {selectedPinned ? <><PinOff className="h-3.5 w-3.5" /> 取消固定（跟随全局）</> : <><Pin className="h-3.5 w-3.5" /> 固定独立参数</>}
                        </button>
                        <button type="button" onClick={() => setSelectedCell(null)} className="text-xs text-slate-400 hover:text-slate-100"><X className="h-4 w-4" /></button>
                      </div>
                    }
                  >
                    {selectedPinned && selectedOverride ? (
                      <>
                        <p className="mb-3 text-[11px] text-emerald-300/80">该格子已固定：全局后处理改动不会影响它，这里的参数只作用于这一格。网格检测仍为全局。</p>
                        <PostProcessControls params={selectedOverride} onChange={(next) => updateOverride(selected.index, next)} onReset={() => updateOverride(selected.index, resetParams(gridRows, gridCols))} showGridKnobs={false} />
                      </>
                    ) : (
                      <p className="text-xs text-slate-400">该格子当前跟随<strong>全局</strong>后处理参数。点「固定独立参数」复制一份自己的参数，之后全局怎么调都不影响它，图标上会出现 PIN 标记。</p>
                    )}
                    <div className="mt-4 flex items-center justify-between gap-3 border-t border-slate-800 pt-4">
                      <p className="text-[11px] text-slate-500">保存的是该格子{selectedPinned ? "按独立参数" : "按全局参数"}处理后的最终图。</p>
                      <button type="button" onClick={() => download(b64DataUrl(selected.imageB64), selected.filename)} className="flex shrink-0 items-center gap-1.5 rounded-lg bg-emerald-500 px-3 py-2 text-xs font-semibold text-slate-950 hover:bg-emerald-400">
                        <Download className="h-3.5 w-3.5" /> 保存此精灵
                      </button>
                    </div>
                  </Card>
                )}

                {selected && (
                  <Card title={`像素编辑器 · #${selected.index + 1} ${selected.name}`} icon={<Sparkles className="h-4 w-4 text-emerald-400" />}>
                    <PixelEditor
                      key={`${selected.index}-${selected.imageB64.slice(0, 24)}`}
                      imageB64={selected.imageB64}
                      size={selectedOverride ? selectedOverride.target_size : params.target_size}
                      palette={selected.palette}
                    />
                  </Card>
                )}

                <Card
                  title="拼版预览"
                  icon={<Eye className="h-4 w-4 text-emerald-400" />}
                  right={<button type="button" onClick={() => setShowContact((v) => !v)} className="text-xs text-slate-400 hover:text-slate-100">{showContact ? "隐藏" : "显示"}</button>}
                >
                  {showContact ? (
                    <img src={b64DataUrl(result.previewB64)} alt="拼版预览" className="block h-auto w-full rounded-lg border border-slate-800" />
                  ) : (
                    <p className="text-xs text-slate-500">所有处理后格子的标注拼版，含空格与 PIN 标记。</p>
                  )}
                </Card>
              </>
            )}
          </>
        )}
      </div>
    </div>
  </>
  );
};

export default SheetStudio;
