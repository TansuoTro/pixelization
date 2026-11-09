import {
  BuildSheetPromptRequest,
  BuildSheetPromptResponse,
  GenerateResponse,
  GenerateTextureParams,
  ProvidersResponse,
  ReprocessParams,
  SheetGenerateRequest,
  SheetGenerateResponse,
  SheetOptions,
  SheetProcessRequest,
  SheetProcessResponse,
} from "../types/texture";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "";

const FALLBACK_PROVIDERS: ProvidersResponse = {
  default_provider: "openai",
  providers: [
    {
      id: "upload_only",
      name: "Custom Image Upload Only (No AI — Pipeline Only)",
      description:
        "Skips AI inference and runs the pixel-art pipeline directly on your uploaded image.",
      configured: true,
      supports_img2img: true,
      is_default: false,
    },
    {
      id: "pollinations",
      name: "Pollinations.ai (Flux — Free, No Key Needed)",
      description:
        "Free cloud AI image generation powered by Flux via Pollinations.ai.",
      configured: true,
      supports_img2img: false,
      is_default: false,
    },
    {
      id: "mock",
      name: "Built-in Procedural Synthesizer (Offline Ready)",
      description:
        "Deterministic procedural sprite & seamless texture generator for instant testing.",
      configured: true,
      supports_img2img: true,
      is_default: false,
    },
    {
      id: "openai",
      name: "OpenAI GPT Image 2",
      description:
        "OpenAI GPT Image 2 via the Images API (OPENAI_API_KEY / OPENAI_BASE_URL).",
      configured: false,
      supports_img2img: true,
      is_default: true,
    },
    {
      id: "gemini",
      name: "Google Gemini / Imagen 3",
      description: "Cloud inference via Google Imagen API (GEMINI_API_KEY).",
      configured: false,
      supports_img2img: false,
      is_default: false,
    },
    {
      id: "replicate",
      name: "Replicate (Flux / SDXL)",
      description: "Cloud inference via Replicate API (REPLICATE_API_TOKEN).",
      configured: false,
      supports_img2img: true,
      is_default: false,
    },
    {
      id: "fal",
      name: "Fal.ai (Flux / Fast SDXL)",
      description: "Fast cloud inference via Fal.ai REST API (FAL_KEY).",
      configured: false,
      supports_img2img: true,
      is_default: false,
    },
    {
      id: "local_sd",
      name: "Local Stable Diffusion (A1111 / Diffusers API)",
      description: "Local GPU inference via LOCAL_SD_URL (http://127.0.0.1:7860).",
      configured: false,
      supports_img2img: true,
      is_default: false,
    },
  ],
};

export async function fetchProviders(): Promise<ProvidersResponse> {
  try {
    const response = await fetch(`${API_BASE}/api/providers`, {
      method: "GET",
      headers: { Accept: "application/json" },
    });
    if (!response.ok) {
      return FALLBACK_PROVIDERS;
    }
    return (await response.json()) as ProvidersResponse;
  } catch {
    return FALLBACK_PROVIDERS;
  }
}

export async function generateTexture(
  params: GenerateTextureParams
): Promise<GenerateResponse> {
  const formData = new FormData();
  formData.append("prompt", params.prompt);
  formData.append("mode", params.mode);
  formData.append("size", String(params.size));
  formData.append("provider", params.provider);
  formData.append("strength", String(params.strength));
  formData.append("palette_colors", String(params.paletteColors));
  formData.append("alpha_threshold", String(params.alphaThreshold));
  formData.append("response_format", "json");

  if (params.referenceImage) {
    formData.append("reference_image", params.referenceImage);
  }

  const response = await fetch(`${API_BASE}/api/generate`, {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    let errorDetail = `Generation failed (${response.status})`;
    try {
      const errJson = (await response.json()) as { detail?: string };
      if (errJson.detail) {
        errorDetail = errJson.detail;
      }
    } catch {
      // Ignore JSON parse errors on fallback error body
    }
    throw new Error(errorDetail);
  }

  return (await response.json()) as GenerateResponse;
}

export async function reprocessTexture(
  params: ReprocessParams
): Promise<GenerateResponse> {
  const response = await fetch(`${API_BASE}/api/reprocess`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(params),
  });

  if (!response.ok) {
    let errorDetail = `Reprocess failed (${response.status})`;
    try {
      const errJson = (await response.json()) as { detail?: string };
      if (errJson.detail) {
        errorDetail = errJson.detail;
      }
    } catch {
      // Ignore JSON parse error
    }
    throw new Error(errorDetail);
  }

  return (await response.json()) as GenerateResponse;
}

// --------------------------------------------------------------------------- //
// Sprite-sheet / atlas batch studio
// --------------------------------------------------------------------------- //

async function readError(response: Response, fallback: string): Promise<string> {
  try {
    const errJson = (await response.json()) as { detail?: string };
    if (errJson.detail) return errJson.detail;
  } catch {
    // Ignore JSON parse error
  }
  return `${fallback} (${response.status})`;
}

const JSON_HEADERS = { "Content-Type": "application/json", Accept: "application/json" };

export async function fetchSheetOptions(): Promise<SheetOptions> {
  const response = await fetch(`${API_BASE}/api/sheet_options`, {
    method: "GET",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error(await readError(response, "Options failed"));
  return (await response.json()) as SheetOptions;
}

export async function buildSheetPrompt(
  params: BuildSheetPromptRequest
): Promise<BuildSheetPromptResponse> {
  const response = await fetch(`${API_BASE}/api/build_sheet_prompt`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(params),
  });
  if (!response.ok) throw new Error(await readError(response, "Prompt build failed"));
  return (await response.json()) as BuildSheetPromptResponse;
}

export async function generateSheet(
  params: SheetGenerateRequest
): Promise<SheetGenerateResponse> {
  const response = await fetch(`${API_BASE}/api/generate_sheet`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(params),
  });
  if (!response.ok) throw new Error(await readError(response, "Atlas generation failed"));
  return (await response.json()) as SheetGenerateResponse;
}

export async function processSheet(
  params: SheetProcessRequest
): Promise<SheetProcessResponse> {
  const response = await fetch(`${API_BASE}/api/process_sheet`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(params),
  });
  if (!response.ok) throw new Error(await readError(response, "Atlas processing failed"));
  return (await response.json()) as SheetProcessResponse;
}

export async function exportSheetZip(
  params: SheetProcessRequest
): Promise<Blob> {
  const response = await fetch(`${API_BASE}/api/export_sheet_zip`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(params),
  });
  if (!response.ok) throw new Error(await readError(response, "ZIP export failed"));
  return await response.blob();
}

export function pngDataUrl(b64: string): string {
  return `data:image/png;base64,${b64}`;
}

export function downloadDataUrl(dataUrl: string, filename: string): void {
  const link = document.createElement("a");
  link.href = dataUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

