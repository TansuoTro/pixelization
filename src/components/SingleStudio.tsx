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
  Package,
  RefreshCw,
  Settings2,
  SlidersHorizontal,
  Sparkles,
  X,
} from "lucide-react";
import type { ProcessParams, Settings, SheetBackground, SheetStyle } from "../types";
import {
  DEFAULT_PROCESS_PARAMS,
  SHEET_BACKGROUNDS,
  STYLE_LABELS,
} from "../config/options";
import { PROVIDER_LABELS, isConfigured } from "../config/settings";
import { buildSinglePrompt } from "../services/prompts";
import { generateAtlasImage, imageSrcFromB64 } from "../services/providers";
import { processSingleImage, type SingleResult } from "../core/sheet";
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

interface Props {
  settings: Settings;
  onOpenSettings: () => void;
}

const message = (err: unknown): string =>
  err instanceof Error ? err.message : "发生未知错误";

export const SingleStudio: React.FC<Props> = ({ settings, onOpenSettings }) => {
  const [description, setDescription] = useState("一个铁锭的物品贴图");
  const [style, setStyle] = useState<SheetStyle>("item");
  const [background, setBackground] = useState<SheetBackground>("white");
  const [extraInstructions, setExtraInstructions] = useState("");
  const [useCustomPrompt, setUseCustomPrompt] = useState(false);
  const [customPrompt, setCustomPrompt] = useState("");
  const [params, setParams] = useState<ProcessParams>({
    ...DEFAULT_PROCESS_PARAMS,
    cell_inset: 0,
    detect_grid: false,
  });
  const [exportName, setExportName] = useState("texture");

  const [referenceB64, setReferenceB64] = useState<string | null>(null);
  const [referenceName, setReferenceName] = useState<string | null>(null);
  const [referenceStrength, setReferenceStrength] = useState(0.75);
  const [referenceInstructions, setReferenceInstructions] = useState("");

  const [rawB64, setRawB64] = useState<string | null>(null);
  const [result, setResult] = useState<SingleResult | null>(null);
  const [wrappedPrompt, setWrappedPrompt] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showPrompt, setShowPrompt] = useState(false);

  const atlasInputRef = useRef<HTMLInputElement | null>(null);
  const requestSeq = useRef(0);

  const promptPreview = useMemo(
    () =>
      buildSinglePrompt({
        description,
        style,
        background,
        extraInstructions,
        customPrompt: useCustomPrompt ? customPrompt : undefined,
        hasReference: !!referenceB64,
        referenceStrength,
        referenceInstructions,
      }),
    [description, style, background, extraInstructions, useCustomPrompt, customPrompt, referenceB64, referenceStrength, referenceInstructions]
  );

  // ---------- real-time local reprocessing (NO API call) ----------
  useEffect(() => {
    if (!rawB64) return;
    const seq = ++requestSeq.current;
    const timer = window.setTimeout(async () => {
      setIsProcessing(true);
      try {
        const next = await processSingleImage(rawB64, params, exportName);
        if (seq === requestSeq.current) setResult(next);
      } catch (err) {
        if (seq === requestSeq.current) setError(message(err));
      } finally {
        if (seq === requestSeq.current) setIsProcessing(false);
      }
    }, 200);
    return () => window.clearTimeout(timer);
  }, [rawB64, params, exportName]);

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
      ++requestSeq.current;
      setRawB64(b64);
      setWrappedPrompt(promptPreview);
      setNotice(
        `已用 ${PROVIDER_LABELS[settings.active]} 生成单张贴图` +
          (settings.allowReference && referenceB64 ? "，含参考图。" : "。")
      );
    } catch (err) {
      setError(message(err));
    } finally {
      setIsGenerating(false);
      setIsProcessing(false);
    }
  }, [isGenerating, settings, promptPreview, referenceB64, onOpenSettings]);

  const handleLoadImage = useCallback(async (file: File) => {
    try {
      const b64 = await fileToBase64(file);
      ++requestSeq.current;
      setRawB64(b64);
      setResult(null);
      setWrappedPrompt(null);
      setError(null);
      setNotice("已载入已有贴图，后续只做本地去背与后处理，不会请求 API。");
    } catch (err) {
      setError(message(err));
    }
  }, []);

  const ready = isConfigured(settings);

  return (
    <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-12">
      {/* LEFT --------------------------------------------------------------- */}
      <div className="space-y-6 lg:col-span-4">
        <Card
          title="单图贴图 Prompt"
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
                : "未配置 API Key — 点右上角「设置」填写（也可先载入已有贴图离线体验）"}
            </div>

            <Field label="贴图描述（单次只生成一张）" hint="描述这一张精灵/方块贴图的内容，例如：一个生锈的铁锭、橡木台阶的侧面。">
              <textarea
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="例如：一个铜质齿轮，16x16 物品图标"
                className={`${INPUT_CLS} text-xs`}
              />
            </Field>

            <SelectField
              label="风格预设"
              value={style}
              options={(Object.keys(STYLE_LABELS) as SheetStyle[]).map((s) => ({ value: s, label: STYLE_LABELS[s] }))}
              onChange={(v) => {
                const next = v as SheetStyle;
                setStyle(next);
                if (next === "block" || next === "machine") {
                  setParams((p) => ({ ...p, cell_mode: "block", trim: false }));
                } else {
                  setParams((p) => ({ ...p, cell_mode: "item", trim: true }));
                }
              }}
            />

            <SelectField
              label="贴图背景（写入 prompt）"
              value={background}
              options={SHEET_BACKGROUNDS.map((b) => ({ value: b, label: b }))}
              onChange={(v) => setBackground(v as SheetBackground)}
              hint="AI 通常输出白底，去背时会做色键去除。"
            />

            <Field label="附加指令（可选）">
              <textarea rows={2} value={extraInstructions} onChange={(e) => setExtraInstructions(e.target.value)} placeholder="例如：保持 10 像素宽、左上光源…" className={`${INPUT_CLS} text-xs`} />
            </Field>

            <Toggle label="用完全自定义 Prompt 覆盖" checked={useCustomPrompt} onChange={setUseCustomPrompt} />
            {useCustomPrompt && (
              <textarea rows={5} value={customPrompt} onChange={(e) => setCustomPrompt(e.target.value)} placeholder="你的完整 prompt，固定基础规则仍会追加。" className={`${INPUT_CLS} font-mono text-xs`} />
            )}

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

            <div className="rounded-xl border border-slate-800 bg-slate-950/60">
              <div className="flex items-center justify-between gap-2 px-3 py-2.5">
                <button type="button" onClick={() => setShowPrompt((v) => !v)} className="flex items-center gap-2 text-xs font-medium text-slate-300 hover:text-white">
                  <SlidersHorizontal className="h-3.5 w-3.5 text-emerald-400" />
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
              {isGenerating ? "正在生成单张贴图…" : "生成单张贴图（1 次 API 调用）"}
            </button>

            <div className="space-y-1.5 border-t border-slate-800 pt-4">
              <input
                ref={atlasInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/bmp,image/gif"
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleLoadImage(f); e.target.value = ""; }}
              />
              <button
                type="button"
                onClick={() => atlasInputRef.current?.click()}
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-slate-700 bg-slate-950/40 px-3 py-2.5 text-xs text-slate-400 transition hover:border-slate-500 hover:text-slate-200"
              >
                <Layers className="h-3.5 w-3.5" /> 载入已有贴图（完全离线，不请求 API）
              </button>
              <p className="text-center text-[10px] text-slate-500">与上方「参考图」不同：这条路径跳过 AI，只跑去背与后处理。</p>
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

        {!rawB64 ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-slate-800 bg-slate-900/90 p-12 text-center">
            <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl border border-emerald-500/30 bg-emerald-500/10 text-emerald-400"><ImagePlus className="h-6 w-6" /></div>
            <p className="text-sm font-medium text-slate-200">单图贴图生成 · 纯浏览器版</p>
            <p className="mt-2 max-w-lg text-xs leading-relaxed text-slate-400">
              一次 Prompt 生成 <strong>一张</strong> 贴图（不切分、不做网格）。浏览器内做去背、重采样到 16/32/64、调色板量化与像素编辑，<strong>后续后处理实时可调，不再请求 API</strong>。
            </p>
            <div className="mt-5 flex flex-wrap justify-center gap-2 text-[11px] text-slate-500">
              {["OpenAI / GPT Image", "SeeDream 火山方舟", "自定义 OAI 端点", "色键去背", "6 种采样", "MedianCut 量化", "像素编辑器", "单张导出"].map((t) => (
                <span key={t} className="rounded-lg border border-slate-800 bg-slate-950 px-2 py-1">{t}</span>
              ))}
            </div>
          </div>
        ) : (
          <>
            <Card
              title="原始贴图"
              icon={<ImagePlus className="h-4 w-4 text-emerald-400" />}
              right={
                <div className="flex items-center gap-2">
                  {isProcessing && <span className="flex items-center gap-1 text-[10px] text-amber-300"><RefreshCw className="h-3 w-3 animate-spin" /> 处理中</span>}
                  <button type="button" onClick={() => download(imageSrcFromB64(rawB64), "mc_raw_texture.png")} className="flex items-center gap-1 text-xs text-slate-400 hover:text-emerald-300">
                    <Download className="h-3.5 w-3.5" /> PNG
                  </button>
                </div>
              }
            >
              <div className="relative overflow-hidden rounded-xl border border-slate-800">
                <img src={imageSrcFromB64(rawB64)} alt="原始贴图" className="block h-auto w-full" />
              </div>
              <p className="mt-2 text-[11px] text-slate-500">
                {result ? `${result.width}x${result.height} 源图` : "正在去背与重采样…"}
              </p>
            </Card>

            <Card
              title="后处理（实时，不请求 API）"
              icon={<SlidersHorizontal className="h-4 w-4 text-emerald-400" />}
            >
              <PostProcessControls params={params} onChange={setParams} onReset={() => setParams(resetParams(params.grid_rows, params.grid_cols))} showGridKnobs={false} />
              <p className="mt-3 text-[11px] text-slate-500">目标分辨率、重采样、去背、量化、裁切都只作用于这一张，实时预览。</p>
            </Card>

            {result && (
              <Card
                title="处理后贴图"
                icon={<Sparkles className="h-4 w-4 text-emerald-400" />}
                right={
                  <button type="button" onClick={() => download(b64DataUrl(result.processedB64), result.filename)} className="flex items-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/15 px-2.5 py-1.5 text-xs text-emerald-300 hover:bg-emerald-500/25">
                    <Package className="h-3.5 w-3.5" /> 下载 (.png)
                  </button>
                }
              >
                <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
                  <div className="flex aspect-square w-48 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-slate-800" style={CHECKER_STYLE}>
                    <img src={b64DataUrl(result.processedB64)} alt="处理后贴图" className="h-full w-full" style={{ imageRendering: "pixelated" }} />
                  </div>
                  <div className="min-w-0 flex-1 space-y-3">
                    <Field label="导出文件名（.png）">
                      <input value={exportName} onChange={(e) => setExportName(e.target.value)} className={INPUT_CLS} placeholder="texture" />
                    </Field>
                    <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                      <span>{result.width}×{result.height} → {params.target_size}×{params.target_size}</span>
                      <span>·</span>
                      <span>{result.empty ? "空（无内容）" : `内容占比 ${(result.contentRatio * 100).toFixed(1)}%`}</span>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {result.palette.slice(0, 16).map((hex, i) => (
                        <span key={`${hex}-${i}`} title={hex} className="h-4 w-4 rounded-sm border border-slate-700" style={{ backgroundColor: hex }} />
                      ))}
                    </div>
                  </div>
                </div>
              </Card>
            )}

            {result && (
              <Card title="像素编辑器" icon={<Sparkles className="h-4 w-4 text-emerald-400" />}>
                <PixelEditor
                  key={result.processedB64.slice(0, 24)}
                  imageB64={result.processedB64}
                  size={params.target_size}
                  palette={result.palette}
                />
              </Card>
            )}
          </>
        )}
      </div>
    </div>
  );
};
