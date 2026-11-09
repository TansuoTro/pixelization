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
  };
}

async function readError(res: Response): Promise<string> {
  try {
    const body = await res.json();
    const msg =
      body?.error?.message ?? body?.error ?? body?.message ?? body?.detail ?? null;
    if (typeof msg === "string") return `HTTP ${res.status}: ${msg}`;
    if (msg && typeof msg === "object") return `HTTP ${res.status}: ${JSON.stringify(msg)}`;
  } catch {
    /* not JSON */
  }
  let text = "";
  try {
    text = (await res.text()).slice(0, 400);
  } catch {
    /* ignore */
  }
  return `HTTP ${res.status}${text ? `: ${text}` : ""}`;
}

/** Convert a returned image URL into raw base64 (needs CORS on that host). */
async function urlToBase64(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`下载生成图片失败：HTTP ${res.status}`);
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
    res = await fetch(join(cfg.endpoint, "images/edits"), {
      method: "POST",
      headers: { Authorization: `Bearer ${cfg.apiKey.trim()}` },
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
    res = await fetch(join(cfg.endpoint, "images/generations"), {
      method: "POST",
      headers: authHeaders(cfg.apiKey),
      body: JSON.stringify(payload),
    });
  }

  if (!res.ok) throw new Error(await readError(res));
  return extractImage(await res.json());
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

  const res = await fetch(join(cfg.endpoint, "images/generations"), {
    method: "POST",
    headers: authHeaders(cfg.apiKey),
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(await readError(res));
  return extractImage(await res.json());
}

export async function generateAtlasImage(args: GenerateImageArgs): Promise<string> {
  const { settings } = args;
  const id = settings.active;
  const cfg = settings[id];
  if (!cfg.apiKey.trim()) {
    throw new Error(`请先在「设置」里填写 ${PROVIDER_LABELS[id]} 的 API Key（sk）。`);
  }
  if (id === "custom" && !cfg.endpoint.trim()) {
    throw new Error("自定义端点请填写完整地址（例如 https://your-host/v1）。");
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
  const res = await fetch(join(cfg.endpoint, "models"), {
    method: "GET",
    headers: { Authorization: `Bearer ${cfg.apiKey.trim()}` },
  });
  if (!res.ok) {
    throw new Error(
      `${await readError(res)}。部分中转/网关不开放 /models 接口，直接在模型名输入框里手填即可。`
    );
  }
  const body = (await res.json()) as { data?: { id?: string }[]; models?: { id?: string }[] };
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
