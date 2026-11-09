import React, { useCallback, useEffect, useState } from "react";
import { AlertCircle, Cuboid, LayoutGrid, RefreshCw, Sparkles } from "lucide-react";
import { ControlPanel } from "./components/ControlPanel";
import { DualPreview } from "./components/DualPreview";
import { PixelCanvasEditor } from "./components/PixelCanvasEditor";
import { SheetStudio } from "./components/SheetStudio";
import { TilePreview3x3 } from "./components/TilePreview3x3";
import {
  fetchProviders,
  generateTexture,
  reprocessTexture,
} from "./services/api";
import {
  GenerateResponse,
  ProviderId,
  ProviderInfo,
  TargetSize,
  TextureMode,
} from "./types/texture";

export const App: React.FC = () => {
  const [prompt, setPrompt] = useState<string>(
    "Enchanted ruby sword with golden hilt"
  );
  const [mode, setMode] = useState<TextureMode>("item");
  const [size, setSize] = useState<TargetSize>(16);
  const [provider, setProvider] = useState<ProviderId>("mock");
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [strength, setStrength] = useState<number>(0.75);
  const [paletteColors, setPaletteColors] = useState<number>(24);
  const [referenceImage, setReferenceImage] = useState<File | null>(null);
  const [referencePreviewUrl, setReferencePreviewUrl] = useState<string | null>(
    null
  );

  const [result, setResult] = useState<GenerateResponse | null>(null);
  const [liveCanvasDataUrl, setLiveCanvasDataUrl] = useState<string>("");
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [studioMode, setStudioMode] = useState<"sheet" | "single">("sheet");

  // Load providers on startup
  useEffect(() => {
    let active = true;
    fetchProviders().then((res) => {
      if (!active) return;
      setProviders(res.providers);
      setProvider(res.default_provider);
    });
    return () => {
      active = false;
    };
  }, []);

  // Create and revoke object URL for uploaded reference image
  const handleReferenceImageChange = useCallback((file: File | null) => {
    setReferencePreviewUrl((prevUrl) => {
      if (prevUrl) {
        URL.revokeObjectURL(prevUrl);
      }
      return file ? URL.createObjectURL(file) : null;
    });
    setReferenceImage(file);
  }, []);

  // Support global Ctrl+V / Cmd+V image paste anywhere on the page
  useEffect(() => {
    const handleGlobalPaste = (e: ClipboardEvent) => {
      if (studioMode === "sheet") return;
      const items = e.clipboardData?.items;
      if (!items) return;
      for (let i = 0; i < items.length; i += 1) {
        const item = items[i];
        if (item.type.startsWith("image/")) {
          const blob = item.getAsFile();
          if (blob) {
            e.preventDefault();
            const ext = (item.type.split("/")[1] || "png").replace("jpeg", "jpg");
            const namedFile = new File(
              [blob],
              blob.name && blob.name !== "image.png"
                ? blob.name
                : `clipboard_pasted.${ext}`,
              { type: blob.type || "image/png" }
            );
            handleReferenceImageChange(namedFile);
            return;
          }
        }
      }
    };

    window.addEventListener("paste", handleGlobalPaste);
    return () => {
      window.removeEventListener("paste", handleGlobalPaste);
    };
  }, [handleReferenceImageChange, studioMode]);

  const handleGenerate = useCallback(async () => {
    setIsGenerating(true);
    setErrorMessage(null);
    try {
      const response = await generateTexture({
        prompt,
        mode,
        size,
        provider,
        strength,
        paletteColors,
        alphaThreshold: 128,
        referenceImage,
      });
      setResult(response);
      setLiveCanvasDataUrl(
        `data:image/png;base64,${response.processed_image_b64}`
      );
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : "An unexpected error occurred during texture generation.";
      setErrorMessage(msg);
    } finally {
      setIsGenerating(false);
    }
  }, [prompt, mode, size, provider, strength, paletteColors, referenceImage]);

  const handleProcessUploadOnly = useCallback(async () => {
    if (!referenceImage) {
      setErrorMessage(
        "Please upload a custom image (.jfif, .jiff, .png, .jpg, .webp) first."
      );
      return;
    }
    setIsGenerating(true);
    setErrorMessage(null);
    try {
      const response = await generateTexture({
        prompt: prompt || "custom_uploaded_image",
        mode,
        size,
        provider: "upload_only",
        strength,
        paletteColors,
        alphaThreshold: 128,
        referenceImage,
      });
      setResult(response);
      setLiveCanvasDataUrl(
        `data:image/png;base64,${response.processed_image_b64}`
      );
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : "An unexpected error occurred while processing the uploaded image.";
      setErrorMessage(msg);
    } finally {
      setIsGenerating(false);
    }
  }, [prompt, mode, size, strength, paletteColors, referenceImage]);
  const handleSizeChange = async (newSize: TargetSize) => {
    setSize(newSize);
    if (!result?.raw_image_b64 || isGenerating) return;
    try {
      const reproc = await reprocessTexture({
        raw_image_b64: result.raw_image_b64,
        mode,
        size: newSize,
        palette_colors: paletteColors,
        alpha_threshold: 128,
        strip_background: mode === "item",
      });
      setResult({
        ...reproc,
        wrapped_prompt: result.wrapped_prompt,
        provider: result.provider,
      });
      setLiveCanvasDataUrl(
        `data:image/png;base64,${reproc.processed_image_b64}`
      );
    } catch {
      // Fallback to next manual generate if backend is unreachable
    }
  };

  const handlePaletteColorsChange = async (newCount: number) => {
    setPaletteColors(newCount);
    if (!result?.raw_image_b64 || isGenerating) return;
    try {
      const reproc = await reprocessTexture({
        raw_image_b64: result.raw_image_b64,
        mode,
        size,
        palette_colors: newCount,
        alpha_threshold: 128,
        strip_background: mode === "item",
      });
      setResult({
        ...reproc,
        wrapped_prompt: result.wrapped_prompt,
        provider: result.provider,
      });
      setLiveCanvasDataUrl(
        `data:image/png;base64,${reproc.processed_image_b64}`
      );
    } catch {
      // Ignore reprocess error
    }
  };

  const handleModeChange = async (newMode: TextureMode) => {
    setMode(newMode);
    if (
      newMode === "block" &&
      prompt === "Enchanted ruby sword with golden hilt"
    ) {
      setPrompt("Mossy cobblestone wall");
    } else if (newMode === "item" && prompt === "Mossy cobblestone wall") {
      setPrompt("Enchanted ruby sword with golden hilt");
    }

    if (!result?.raw_image_b64 || isGenerating) return;
    try {
      const reproc = await reprocessTexture({
        raw_image_b64: result.raw_image_b64,
        mode: newMode,
        size,
        palette_colors: paletteColors,
        alpha_threshold: 128,
        strip_background: newMode === "item",
      });
      setResult({
        ...reproc,
        wrapped_prompt: result.wrapped_prompt,
        provider: result.provider,
      });
      setLiveCanvasDataUrl(
        `data:image/png;base64,${reproc.processed_image_b64}`
      );
    } catch {
      // Ignore reprocess error
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      <header className="border-b border-slate-800/80 bg-slate-900/60 backdrop-blur sticky top-0 z-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3.5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/15 border border-emerald-500/40 flex items-center justify-center text-emerald-400">
              <Cuboid className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-base sm:text-lg font-bold tracking-tight text-slate-100">
                Minecraft Texture Generator
              </h1>
              <p className="text-xs text-slate-400">
                16x16, 32x32 &amp; 64x64 item and block texture studio
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 text-xs">
            <div className="flex items-center gap-1 rounded-xl border border-slate-800 bg-slate-950/60 p-1">
              <button
                type="button"
                onClick={() => setStudioMode("sheet")}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                  studioMode === "sheet"
                    ? "bg-emerald-500/15 text-emerald-300"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                <LayoutGrid className="w-3.5 h-3.5" />
                Sprite Sheet Studio
              </button>
              <button
                type="button"
                onClick={() => setStudioMode("single")}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                  studioMode === "single"
                    ? "bg-emerald-500/15 text-emerald-300"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                <Cuboid className="w-3.5 h-3.5" />
                Single Texture
              </button>
            </div>
            <span className="px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 font-mono">
              {studioMode === "sheet" ? "GPT Image 2" : provider}
            </span>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto w-full px-4 sm:px-6 py-6 flex-1">
        {errorMessage && (
          <div
            role="alert"
            className="mb-6 flex items-center justify-between gap-3 rounded-xl bg-rose-950/70 border border-rose-500/50 px-4 py-3 text-sm text-rose-200"
          >
            <div className="flex items-center gap-2.5">
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
              <span>{errorMessage}</span>
            </div>
            <button
              type="button"
              onClick={() => setErrorMessage(null)}
              className="text-xs font-medium underline hover:text-white"
            >
              Dismiss
            </button>
          </div>
        )}

        {studioMode === "single" ? (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left Column: Generation Controls */}
          <div className="lg:col-span-4">
            <ControlPanel
              prompt={prompt}
              onPromptChange={setPrompt}
              mode={mode}
              onModeChange={handleModeChange}
              size={size}
              onSizeChange={handleSizeChange}
              provider={provider}
              providers={providers}
              onProviderChange={setProvider}
              strength={strength}
              onStrengthChange={setStrength}
              paletteColors={paletteColors}
              onPaletteColorsChange={handlePaletteColorsChange}
              referenceImage={referenceImage}
              referencePreviewUrl={referencePreviewUrl}
              onReferenceImageChange={handleReferenceImageChange}
              onGenerate={handleGenerate}
              onProcessUploadOnly={handleProcessUploadOnly}
              isGenerating={isGenerating}
            />
          </div>

          {/* Right Column: Dual Preview, Interactive Pixel Editor, and 3x3 Block Tiling */}
          <div className="lg:col-span-8 space-y-6">
            {result ? (
              <>
                <DualPreview
                  rawImageB64={result.raw_image_b64}
                  processedDataUrl={
                    liveCanvasDataUrl ||
                    `data:image/png;base64,${result.processed_image_b64}`
                  }
                  wrappedPrompt={result.wrapped_prompt}
                  size={result.size}
                  mode={result.mode}
                  paletteCount={result.palette.length || paletteColors}
                />

                <PixelCanvasEditor
                  initialImageB64={result.processed_image_b64}
                  size={result.size}
                  mode={result.mode}
                  palette={result.palette}
                  onCanvasUpdate={setLiveCanvasDataUrl}
                />

                <TilePreview3x3
                  textureDataUrl={
                    liveCanvasDataUrl ||
                    `data:image/png;base64,${result.processed_image_b64}`
                  }
                  size={result.size}
                  mode={result.mode}
                />
              </>
            ) : isGenerating ? (
              <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-12 flex flex-col items-center justify-center text-center">
                <RefreshCw className="w-8 h-8 text-emerald-400 animate-spin mb-3" />
                <p className="text-sm font-medium text-slate-200">
                  Generating &amp; Post-Processing Texture...
                </p>
                <p className="text-xs text-slate-500 mt-1">
                  Running {provider.toUpperCase()} inference + rembg + Nearest-Neighbor + MedianCut
                </p>
              </div>
            ) : (
              <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-12 flex flex-col items-center justify-center text-center">
                <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 mb-3">
                  <Sparkles className="w-6 h-6" />
                </div>
                <p className="text-sm font-medium text-slate-200">
                  Ready to Generate Minecraft Textures
                </p>
                <p className="text-xs text-slate-400 mt-1 max-w-md">
                  Select Item or Block mode, choose your AI provider and target size (16x16, 32x32, or 64x64) on the left, then click Generate.
                </p>
              </div>
            )}
          </div>
        </div>
        ) : (
          <SheetStudio />
        )}
      </main>
    </div>
  );
};

export default App;

