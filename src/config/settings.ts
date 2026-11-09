/** Provider settings persisted in the browser (localStorage). No server, no .env. */
import type { ProviderConfig, ProviderId, Settings } from "../types";

const STORAGE_KEY = "mc-sprite-sheet-studio.settings.v3";

/**
 * Each provider ships BOTH endpoints. The user picks the connection OPTION
 * (proxy / direct) in Settings; switching it swaps the active endpoint without
 * losing the other value. Direct URLs only work if that host returns CORS
 * headers — the "test direct connection" button checks that.
 */
function cfg(
  proxyEndpoint: string,
  directEndpoint: string,
  extra: Partial<ProviderConfig> = {}
): ProviderConfig {
  return {
    mode: "proxy",
    endpoint: proxyEndpoint,
    proxyEndpoint,
    directEndpoint,
    apiKey: "",
    model: "",
    size: "1024x1024",
    ...extra,
  };
}

export const DEFAULT_SETTINGS: Settings = {
  active: "openai",
  openai: cfg("/proxy/openai", "https://api.openai.com/v1", {
    model: "gpt-image-1",
  }),
  seedream: cfg("/proxy/ark", "https://ark.cn-beijing.volces.com/api/v3", {
    model: "doubao-seedream-4-0-250828",
    size: "2K",
    outputFormat: "png",
    watermark: false,
  }),
  custom: cfg("/proxy/codetab", "https://api.code-tab.com/v1"),
  allowReference: true,
};

export const PROVIDER_LABELS: Record<ProviderId, string> = {
  openai: "OpenAI / GPT Image",
  seedream: "SeeDream（火山方舟）",
  custom: "自定义端点（OAI 格式兼容）",
};

function mergeConfig(base: ProviderConfig, saved: Partial<ProviderConfig> | undefined): ProviderConfig {
  const merged = { ...base, ...(saved ?? {}) };
  // Old saved settings (v2) only had `endpoint`; adopt it into the matching slot.
  if (!merged.proxyEndpoint) merged.proxyEndpoint = merged.endpoint || base.proxyEndpoint;
  if (!merged.directEndpoint) merged.directEndpoint = base.directEndpoint;
  if (!merged.mode) merged.mode = "proxy";
  if (!merged.endpoint) {
    merged.endpoint = merged.mode === "direct" ? merged.directEndpoint : merged.proxyEndpoint;
  }
  return merged;
}

function deepMerge(base: Settings, saved: Partial<Settings> | null): Settings {
  if (!saved) return { ...base };
  return {
    active: saved.active ?? base.active,
    openai: mergeConfig(base.openai, saved.openai),
    seedream: mergeConfig(base.seedream, saved.seedream),
    custom: mergeConfig(base.custom, saved.custom),
    allowReference: saved.allowReference ?? base.allowReference,
  };
}

/** Resolve the effective endpoint for a config (mode wins over a stale endpoint). */
export function effectiveEndpoint(c: ProviderConfig): string {
  return c.mode === "direct" ? c.directEndpoint : c.proxyEndpoint;
}

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem("mc-sprite-sheet-studio.settings.v2");
    if (!raw) return { ...DEFAULT_SETTINGS };
    return deepMerge(DEFAULT_SETTINGS, JSON.parse(raw) as Partial<Settings>);
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Storage may be disabled (private mode); the in-memory copy still works.
  }
}

export function clearSettings(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem("mc-sprite-sheet-studio.settings.v2");
  } catch {
    /* ignore */
  }
}

export function isConfigured(settings: Settings): boolean {
  const p = settings[settings.active];
  if (!p.apiKey.trim()) return false;
  if (settings.active === "custom" && !effectiveEndpoint(p).trim()) return false;
  if (settings.active === "custom" && !p.model.trim()) return false;
  return true;
}
