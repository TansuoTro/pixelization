/**
 * Browser-only provider clients. Every request is issued from the user's own
 * browser with their own key. No backend, no proxy function — only the static
 * edge rewrites in netlify.toml that solve CORS.
 *
 *  - OpenAI / custom (OAI-compatible): POST {endpoint}/images/generations
 *    or /images/edits (multipart when a reference image is attached).
 *  - SeeDream (Volcengine Ark): POST {endpoint}/images/generations with the
 *    Ark-specific fields documented at
 *    https://docs.volcengine.com/docs/ark/image-generation-api?lang=zh
 */
import type { ProviderConfig, ProviderId, Settings } from "../types";
import { PROVIDER_LABELS } from "../config/settings";
import { base64ToBytes, bytesToBase64, fileToBase64 } from "../core/image";

export interface GenerateImageArgs {
  settings: Settings;
  prompt: string;
  /** raw base64 PNG of the reference image, if any */
  referenceB64?: string | null;
}

function join(base: string, path: string): string {
  return `${base.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

function authHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey.trim()}`,
    "Content-Type": "application/json",
    // Some relays/gateways return an HTML page when Accept is */*.
    Accept: "application/json",
  };
}

/**
 * Wrap fetch so a bare browser-level "Failed to fetch" (which carries NO status
 * code) is translated into an actionable diagnosis. This almost always means a
 * cross-origin CORS rejection or an unreachable endpoint.
 */
async function safeFetch(url: string, init: RequestInit): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    const absolute = /^https?:\/\//i.test(url);
    throw new Error(
      `无法连接端点（${raw}）。\n` +
        (absolute
          ? `当前填的是跨域绝对地址 ${url}，浏览器会因 CORS 直接拒绝。请在设置里改用同源相对路径（如 /proxy/codetab），并在 netlify.toml 中为该域名配置 [[redirects]] 转发。`
          : `同源代理路径 ${url} 未生效：请确认已重新部署 netlify.toml（含对应 [[redirects]]），或本地已重启 npm run dev 让 vite proxy 生效。`) +
        "\n也可能是 key/网络/证书问题；可在浏览器 DevTools → Network 里查看该请求是否被 CORS 拦截。"
    );
  }
  return res;
}

function isHtml(text: string, contentType: string): boolean {
  return (
    contentType.toLowerCase().includes("text/html") ||
    /^<(!doctype|html|head|body|script)/i.test(text.trimStart())
  );
}

const HTML_DIAGNOSIS =
  "返回的不是 JSON 而是 HTML 页面，说明这次请求没有打到真实的 API 接口，而是被站点首页兜底了（SPA fallback / 网关首页）。" +
  "排查：① netlify.toml 里对应的 [[redirects]] 是否已重新部署；② 本地是否重启过 npm run dev 让 vite proxy 生效；" +
  "③ 该端点是否真的提供这个接口（很多中转站不提供 GET /models，直接手填模型名即可）；④ DevTools → Network 看这条请求的真实 URL 与状态码。";

/** Read the body ONCE, then give a useful message whether it is JSON or HTML. */
async function readError(res: Response): Promise<string> {
  let text = "";
  let contentType = "";
  try {
    contentType = res.headers.get("content-type") || "";
    text = await res.text();
  } catch {
    return `HTTP ${res.status}（无法读取响应体）`;
  }
  if (isHtml(text, contentType)) {
    return `HTTP ${res.status}：${HTML_DIAGNOSIS}`;
  }
  try {
    const body = JSON.parse(text) as Record<string, unknown>;
    const msg = body?.error ?? body?.message ?? body?.detail ?? null;
    if (typeof msg === "string") return `HTTP ${res.status}: ${msg}`;
    if (msg && typeof msg === "object") {
      const nested = (msg as Record<string, unknown>).message;
      return `HTTP ${res.status}: ${typeof nested === "string" ? nested : JSON.stringify(msg)}`;
    }
  } catch {
    /* not JSON */
  }
  return `HTTP ${res.status}${text ? `: ${text.slice(0, 300)}` : ""}`;
}

/** Parse a successful response as JSON, with an HTML-page diagnosis. */
async function readJson(res: Response, context: string): Promise<unknown> {
  let text = "";
  let contentType = "";
  try {
    contentType = res.headers.get("content-type") || "";
    text = await res.text();
  } catch {
    throw new Error(`${context}：无法读取响应体。`);
  }
  if (isHtml(text, contentType)) {
    throw new Error(`${context} ${HTML_DIAGNOSIS}`);
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(
      `${context}：响应不是合法 JSON（content-type=${contentType || "未知"}，前 160 字符：${text.slice(0, 160)}）`
    );
  }
}

/** Convert a returned image URL into raw base64 (needs CORS on that host). */
async function urlToBase64(url: string): Promise<string> {
  const res = await safeFetch(url, { method: "GET", headers: { Accept: "image/*" } });
  if (!res.ok) throw new Error(await readError(res));
  const contentType = res.headers.get("content-type") || "";
  if (isHtml(await res.clone().text(), contentType)) {
    throw new Error(`下载生成图片：${HTML_DIAGNOSIS}`);
  }
  const blob = await res.blob();
  return fileToBase64(blob);
}

interface ImageItem {
  b64_json?: string;
  url?: string;
}

async function extractImage(body: unknown): Promise<string> {
  const data = (body as { data?: ImageItem[] })?.data;
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error("响应中没有 data 图像列表，请检查端点是否为图片生成接口。");
  }
  const item = data[0];
  if (item?.b64_json) return item.b64_json;
  if (item?.url) return urlToBase64(item.url);
  throw new Error(
    "响应既没有 b64_json 也没有 url。建议把 response_format 设为 b64_json（SeeDream 可在设置里确认）。"
  );
}

function pngBlobFromBase64(b64: string): Blob {
  return new Blob([base64ToBytes(b64)], { type: "image/png" });
}

async function openaiGenerate(cfg: ProviderConfig, args: GenerateImageArgs): Promise<string> {
  const { prompt, referenceB64 } = args;
  let res: Response;

  if (referenceB64) {
    // /images/edits is multipart/form-data, not JSON.
    const form = new FormData();
    form.append("model", cfg.model.trim());
    form.append("prompt", prompt);
    form.append("size", cfg.size || "1024x1024");
    form.append("n", "1");
    form.append("image", pngBlobFromBase64(referenceB64), "reference.png");
    res = await safeFetch(join(cfg.endpoint, "images/edits"), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cfg.apiKey.trim()}`,
        Accept: "application/json",
      },
      body: form,
    });
  } else {
    const payload: Record<string, unknown> = {
      model: cfg.model.trim(),
      prompt,
      size: cfg.size || "1024x1024",
      n: 1,
    };
    // gpt-image-* natively returns b64_json; dall-e-3 needs response_format.
    if (!/^gpt-image/i.test(cfg.model)) payload.response_format = "b64_json";
    res = await safeFetch(join(cfg.endpoint, "images/generations"), {
      method: "POST",
      headers: authHeaders(cfg.apiKey),
      body: JSON.stringify(payload),
    });
  }

  if (!res.ok) throw new Error(await readError(res));
  return extractImage(await readJson(res, "生成图片"));
}

async function seedreamGenerate(cfg: ProviderConfig, args: GenerateImageArgs): Promise<string> {
  const { prompt, referenceB64 } = args;
  const payload: Record<string, unknown> = {
    model: cfg.model.trim(),
    prompt,
    size: cfg.size || "2K",
    response_format: "b64_json",
    output_format: cfg.outputFormat ?? "png",
    watermark: cfg.watermark ?? false,
    sequential_image_generation: "disabled",
  };
  // Ark accepts either a URL or a data URL for the reference image.
  if (referenceB64) payload.image = `data:image/png;base64,${referenceB64}`;

  const res = await safeFetch(join(cfg.endpoint, "images/generations"), {
    method: "POST",
    headers: authHeaders(cfg.apiKey),
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(await readError(res));
  return extractImage(await readJson(res, "生成图片"));
}

export async function generateAtlasImage(args: GenerateImageArgs): Promise<string> {
  const { settings } = args;
  const id = settings.active;
  const cfg = settings[id];
  if (!cfg.apiKey.trim()) {
    throw new Error(`请先在「设置」里填写 ${PROVIDER_LABELS[id]} 的 API Key（sk）。`);
  }
  if (id === "custom" && !cfg.endpoint.trim()) {
    throw new Error(
      "自定义端点请填写同源相对路径（例如 /proxy/codetab），并在 netlify.toml 配置对应 [[redirects]]；不要填 https:// 绝对地址，否则会被 CORS 拦截。"
    );
  }
  if (!cfg.model.trim()) {
    throw new Error("请填写 model 请求名（自定义端点必须自行指定模型）。");
  }
  if (id === "seedream") return seedreamGenerate(cfg, args);
  return openaiGenerate(cfg, args);
}

/** GET {endpoint}/models — returns model ids, or a friendly error. */
export async function fetchModelIds(cfg: ProviderConfig): Promise<string[]> {
  if (!cfg.apiKey.trim()) throw new Error("请先填写 API Key 再拉取模型列表。");
  if (!cfg.endpoint.trim()) throw new Error("请先填写端点地址。");
  const res = await safeFetch(join(cfg.endpoint, "models"), {
    method: "GET",
    headers: {
      Authorization: `Bearer ${cfg.apiKey.trim()}`,
      Accept: "application/json",
    },
  });
  if (!res.ok) {
    throw new Error(
      `${await readError(res)}。部分中转/网关不开放 /models 接口，直接在模型名输入框里手填即可。`
    );
  }
  const body = (await readJson(res, "拉取模型列表 GET /models")) as {
    data?: { id?: string }[];
    models?: { id?: string }[];
  };
  const list = body.data ?? body.models ?? [];
  const ids = list.map((m) => m.id).filter((x): x is string => typeof x === "string" && !!x);
  if (ids.length === 0) throw new Error("模型列表为空，请直接手填模型名。");
  return ids.sort();
}

/** Re-export so callers can build a data URL preview of a raw base64 image. */
export function imageSrcFromB64(b64: string): string {
  return `data:image/png;base64,${b64}`;
}

export function providerLabel(id: ProviderId): string {
  return PROVIDER_LABELS[id];
}

export { bytesToBase64 };
