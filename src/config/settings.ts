/** Provider settings persisted in the browser (localStorage). No server, no .env. */
import type { ProviderId, Settings } from "../types";

const STORAGE_KEY = "mc-sprite-sheet-studio.settings.v2";

/**
 * Default endpoints are same-origin proxy paths handled by netlify.toml
 * (production) and vite.config.ts (dev). Both providers natively reject
 * cross-origin browser calls, so a plain static site needs the edge rewrite.
 * Users may paste a direct URL instead if their endpoint sends CORS headers.
 */
export const DEFAULT_SETTINGS: Settings = {
  active: "openai",
  openai: {
    endpoint: "/proxy/openai",
    apiKey: "",
    model: "gpt-image-1",
    size: "1024x1024",
  },
  seedream: {
    endpoint: "/proxy/ark",
    apiKey: "",
    model: "doubao-seedream-4-0-250828",
    size: "2K",
    outputFormat: "png",
    watermark: false,
  },
  custom: {
    endpoint: "",
    apiKey: "",
    model: "",
    size: "1024x1024",
  },
  allowReference: true,
};

export const PROVIDER_LABELS: Record<ProviderId, string> = {
  openai: "OpenAI / GPT Image",
  seedream: "SeeDream（火山方舟）",
  custom: "自定义端点（OAI 格式兼容）",
};

function deepMerge(base: Settings, saved: Partial<Settings> | null): Settings {
  if (!saved) return { ...base };
  return {
    active: saved.active ?? base.active,
    openai: { ...base.openai, ...(saved.openai ?? {}) },
    seedream: { ...base.seedream, ...(saved.seedream ?? {}) },
    custom: { ...base.custom, ...(saved.custom ?? {}) },
    allowReference: saved.allowReference ?? base.allowReference,
  };
}

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
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
  } catch {
    /* ignore */
  }
}

export function isConfigured(settings: Settings): boolean {
  const p = settings[settings.active];
  if (!p.apiKey.trim()) return false;
  if (settings.active === "custom" && !p.endpoint.trim()) return false;
  if (settings.active === "custom" && !p.model.trim()) return false;
  return true;
}
