import React, { useEffect, useState } from "react";
import {
  AlertTriangle,
  ChevronDown,
  Eye,
  EyeOff,
  KeyRound,
  ListPlus,
  RefreshCw,
  Save,
  Server,
  Settings2,
  X,
} from "lucide-react";
import type { ProviderConfig, ProviderId, Settings } from "../types";
import {
  ENDPOINT_PRESETS,
  OPENAI_MODEL_PRESETS,
  OPENAI_SIZES,
  SEEDREAM_MODEL_PRESETS,
  SEEDREAM_SIZES,
} from "../config/options";
import { DEFAULT_SETTINGS, PROVIDER_LABELS, clearSettings } from "../config/settings";
import { fetchModelIds, probeDirectConnection } from "../services/providers";

interface Props {
  settings: Settings;
  onSave: (s: Settings) => void;
  onClose: () => void;
}

const PROVIDERS: ProviderId[] = ["openai", "seedream", "custom"];

const inputCls =
  "w-full rounded-lg bg-slate-950 border border-slate-800 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 font-mono";

export const SettingsModal: React.FC<Props> = ({ settings, onSave, onClose }) => {
  const [draft, setDraft] = useState<Settings>(() => JSON.parse(JSON.stringify(settings)) as Settings);
  const [showKey, setShowKey] = useState<Record<ProviderId, boolean>>({
    openai: false,
    seedream: false,
    custom: false,
  });
  const [models, setModels] = useState<Record<ProviderId, string[]>>({
    openai: [],
    seedream: [],
    custom: [],
  });
  const [modelError, setModelError] = useState<string | null>(null);
  const [fetching, setFetching] = useState<ProviderId | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [probing, setProbing] = useState(false);
  const [probe, setProbe] = useState<{ direct: boolean; detail: string } | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const patch = (id: ProviderId, field: keyof ProviderConfig, value: string | boolean) => {
    setDraft((prev) => ({
      ...prev,
      [id]: { ...prev[id], [field]: value },
    }));
  };

  const handleFetchModels = async (id: ProviderId) => {
    setFetching(id);
    setModelError(null);
    try {
      const ids = await fetchModelIds(draft[id]);
      setModels((prev) => ({ ...prev, [id]: ids }));
    } catch (err) {
      setModelError(err instanceof Error ? err.message : "拉取模型列表失败");
    } finally {
      setFetching(null);
    }
  };

  const cfg = draft[draft.active];
  const presets = draft.active === "seedream" ? SEEDREAM_MODEL_PRESETS : OPENAI_MODEL_PRESETS;
  const sizeOptions = draft.active === "seedream" ? SEEDREAM_SIZES : OPENAI_SIZES;
  const fetched = models[draft.active];

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 backdrop-blur-sm p-4 sm:p-8">
      <div className="w-full max-w-2xl rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl">
        <div className="flex items-center justify-between gap-3 border-b border-slate-800 px-5 py-4">
          <h2 className="flex items-center gap-2 text-base font-semibold text-slate-100">
            <Settings2 className="w-4 h-4 text-emerald-400" />
            设置 · Provider
          </h2>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-100">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-5 px-5 py-5">
          <div className="flex items-start gap-2.5 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2.5 text-[11px] leading-relaxed text-amber-200">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>
              纯浏览器应用：API Key 仅保存在<strong>本机浏览器 localStorage</strong>，并随每次请求直接发送到所选端点。
              请勿在公用设备使用；建议使用权限受限、可随时吊销的 Key。本站不上传、不记录你的 Key。
            </span>
          </div>

          {/* Provider tabs */}
          <div className="grid grid-cols-3 gap-2">
            {PROVIDERS.map((id) => (
              <button
                key={id}
                type="button"
                onClick={() => setDraft((p) => ({ ...p, active: id }))}
                className={`rounded-xl border px-3 py-2.5 text-xs font-medium transition ${
                  draft.active === id
                    ? "bg-emerald-500/15 border-emerald-500 text-emerald-300"
                    : "bg-slate-950/60 border-slate-800 text-slate-400 hover:border-slate-700 hover:text-slate-200"
                }`}
              >
                {PROVIDER_LABELS[id]}
              </button>
            ))}
          </div>

          {/* API key */}
          <div>
            <label className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              <KeyRound className="w-3.5 h-3.5" /> API Key (sk)
            </label>
            <div className="relative">
              <input
                type={showKey[draft.active] ? "text" : "password"}
                value={cfg.apiKey}
                onChange={(e) => patch(draft.active, "apiKey", e.target.value)}
                placeholder="sk-..."
                autoComplete="off"
                spellCheck={false}
                className={`${inputCls} pr-10`}
              />
              <button
                type="button"
                onClick={() =>
                  setShowKey((p) => ({ ...p, [draft.active]: !p[draft.active] }))
                }
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-200"
              >
                {showKey[draft.active] ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            <p className="mt-1 text-[11px] text-slate-500">
              {draft.active === "custom"
                ? "自定义端点必须同时填写地址、Key 和 model。"
                : `${PROVIDER_LABELS[draft.active]} 只需填 sk，其余已内置默认值。`}
            </p>
          </div>

          {/* Endpoint + size */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                <Server className="w-3.5 h-3.5" /> 端点地址
              </label>
              <input
                type="text"
                value={cfg.endpoint}
                onChange={(e) => patch(draft.active, "endpoint", e.target.value)}
                placeholder="/proxy/codetab"
                spellCheck={false}
                className={inputCls}
              />
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {ENDPOINT_PRESETS.map((preset) => (
                  <button
                    key={preset.value}
                    type="button"
                    onClick={() => patch(draft.active, "endpoint", preset.value)}
                    className={`rounded-lg border px-2 py-1 font-mono text-[10px] transition ${
                      cfg.endpoint === preset.value
                        ? "bg-emerald-500/15 border-emerald-500 text-emerald-300"
                        : "bg-slate-950/60 border-slate-800 text-slate-500 hover:border-slate-700 hover:text-slate-300"
                    }`}
                  >
                    {preset.value}
                  </button>
                ))}
              </div>
              <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
                请求始终由<strong>你的浏览器</strong>直接发出（无后端、Key 只存本机）。填绝对 https:// 地址属于跨域，
                <strong>只有当该端点自己返回 CORS 头时才可用</strong>；否则用同源 <code className="font-mono">/proxy/xxx</code>（CDN 边缘转发，仍是纯静态站点）。
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={probing || !cfg.apiKey.trim() || !cfg.endpoint.trim()}
                  onClick={async () => {
                    setProbing(true);
                    setProbe(null);
                    try {
                      const r = await probeDirectConnection(draft[draft.active]);
                      setProbe(r);
                    } catch (e) {
                      setProbe({ direct: false, detail: e instanceof Error ? e.message : String(e) });
                    } finally {
                      setProbing(false);
                    }
                  }}
                  className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-950/60 px-2.5 py-1.5 text-[11px] text-slate-300 hover:border-emerald-500/60 hover:text-emerald-300 disabled:opacity-50"
                >
                  {probing ? <RefreshCw className="h-3 w-3 animate-spin" /> : <ListPlus className="h-3 w-3" />}
                  测试直连是否可用（GET /models）
                </button>
                <span className="text-[10px] text-slate-600">仅在你点击时发一次请求，不做生成调用</span>
              </div>
              {probe && (
                <p className={`mt-2 rounded-lg border px-2.5 py-2 text-[11px] leading-relaxed ${
                  probe.direct ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200" : "border-amber-500/40 bg-amber-500/10 text-amber-200"
                }`}>
                  {probe.detail}
                </p>
              )}
            </div>
            <div>
              <label className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                图片尺寸 size
              </label>
              <input
                type="text"
                list="size-options"
                value={cfg.size}
                onChange={(e) => patch(draft.active, "size", e.target.value)}
                className={inputCls}
              />
              <datalist id="size-options">
                {sizeOptions.map((s) => (
                  <option key={s} value={s} />
                ))}
              </datalist>
            </div>
          </div>

          {/* Model name + list */}
          <div>
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                Model 请求名（可自由填写 / 自定义端点必填）
              </label>
              <button
                type="button"
                onClick={() => handleFetchModels(draft.active)}
                disabled={fetching !== null}
                className="flex items-center gap-1 text-[11px] text-emerald-300 hover:text-emerald-200 disabled:opacity-50"
              >
                {fetching === draft.active ? (
                  <RefreshCw className="w-3 h-3 animate-spin" />
                ) : (
                  <ListPlus className="w-3 h-3" />
                )}
                拉取模型列表（/models）
              </button>
            </div>
            <input
              type="text"
              list="model-options"
              value={cfg.model}
              onChange={(e) => patch(draft.active, "model", e.target.value)}
              placeholder={draft.active === "custom" ? "例如 gpt-image-2 或你的中转模型名" : "选择或手填模型名"}
              spellCheck={false}
              className={inputCls}
            />
            <datalist id="model-options">
              {(fetched.length ? fetched : presets).map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {(fetched.length ? fetched.slice(0, 40) : presets).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => patch(draft.active, "model", m)}
                  className={`text-[10px] px-2 py-1 rounded-lg border font-mono transition ${
                    cfg.model === m
                      ? "bg-emerald-500/15 border-emerald-500 text-emerald-300"
                      : "bg-slate-950/60 border-slate-800 text-slate-500 hover:border-slate-700 hover:text-slate-300"
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-[11px] text-slate-500">
              内置候选仅为快捷填充，以端点 <code className="font-mono">/models</code> 实际返回为准；
              模型名始终可直接编辑（包括 GPT Image 2.5 / Sunburst 等新模型）。
            </p>
            {modelError && (
              <p className="mt-2 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-[11px] text-rose-200">
                {modelError}
              </p>
            )}
          </div>

          {/* SeeDream-only options */}
          {draft.active === "seedream" && (
            <div className="grid grid-cols-2 gap-3 rounded-xl border border-slate-800 bg-slate-950/40 p-3">
              <div>
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  output_format
                </label>
                <select
                  value={cfg.outputFormat ?? "png"}
                  onChange={(e) => patch(draft.active, "outputFormat", e.target.value)}
                  className={inputCls}
                >
                  <option value="png">png</option>
                  <option value="jpeg">jpeg</option>
                </select>
              </div>
              <label className="flex items-center gap-2 pt-5 text-xs text-slate-300">
                <input
                  type="checkbox"
                  checked={cfg.watermark ?? false}
                  onChange={(e) => patch(draft.active, "watermark", e.target.checked)}
                  className="w-4 h-4 accent-emerald-500"
                />
                watermark（水印）
              </label>
              <p className="col-span-2 text-[11px] text-slate-500">
                Ark 端点 <code className="font-mono">/api/v3/images/generations</code>，
                默认请求 <code className="font-mono">response_format=b64_json</code> 以避免跨域图片污染 Canvas。
              </p>
            </div>
          )}

          {/* Advanced */}
          <div className="border-t border-slate-800 pt-3">
            <button
              type="button"
              onClick={() => setShowAdvanced((v) => !v)}
              className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200"
            >
              <ChevronDown className={`w-3.5 h-3.5 transition ${showAdvanced ? "rotate-180" : ""}`} />
              高级 / CORS 说明
            </button>
            {showAdvanced && (
              <div className="mt-2 space-y-2 text-[11px] leading-relaxed text-slate-500">
                <p>
                  OpenAI 与火山方舟默认都不允许浏览器跨域直连。本项目在{" "}
                  <code className="font-mono">netlify.toml</code> /{" "}
                  <code className="font-mono">vite.config.ts</code> 里预置了同源反向代理：
                  <code className="font-mono"> /proxy/openai</code> → api.openai.com/v1，
                  <code className="font-mono"> /proxy/ark</code> → ark.cn-beijing.volces.com/api/v3。
                  这是静态 rewrite，不是 serverless function，部署后依然是纯静态站点。
                </p>
                <p>
                  自定义端点请填写<strong>支持 CORS</strong> 的地址；若端点不支持，
                  可在 netlify.toml 里照上方格式加一条 rewrite，再把地址填成对应的{" "}
                  <code className="font-mono">/proxy/xxx</code> 相对路径。
                </p>
                <label className="flex items-center gap-2 pt-1 text-xs text-slate-300">
                  <input
                    type="checkbox"
                    checked={draft.allowReference}
                    onChange={(e) => setDraft((p) => ({ ...p, allowReference: e.target.checked }))}
                    className="w-4 h-4 accent-emerald-500"
                  />
                  允许上传参考图（走 /images/edits 或 Ark 的 image 字段）
                </label>
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-slate-800 px-5 py-4">
          <button
            type="button"
            onClick={() => {
              clearSettings();
              setDraft(JSON.parse(JSON.stringify(DEFAULT_SETTINGS)) as Settings);
            }}
            className="text-xs text-slate-500 hover:text-rose-300"
          >
            清除本机保存
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-slate-700 px-4 py-2 text-xs text-slate-300 hover:bg-slate-800"
            >
              取消
            </button>
            <button
              type="button"
              onClick={() => onSave(draft)}
              className="flex items-center gap-1.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 px-4 py-2 text-xs font-semibold text-slate-950"
            >
              <Save className="w-3.5 h-3.5" /> 保存到浏览器
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
