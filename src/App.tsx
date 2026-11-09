import React, { useEffect, useState } from "react";
import { Cuboid, Github, Settings2 } from "lucide-react";
import type { Settings } from "./types";
import { loadSettings, PROVIDER_LABELS, saveSettings } from "./config/settings";
import { SettingsModal } from "./components/SettingsModal";
import { SheetStudio } from "./components/SheetStudio";

const App: React.FC = () => {
  const [settings, setSettings] = useState<Settings>(() => loadSettings());
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => {
    document.title = "Minecraft Sprite Sheet Studio · 纯浏览器";
  }, []);

  const handleSave = (next: Settings) => {
    setSettings(next);
    saveSettings(next);
    setShowSettings(false);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="sticky top-0 z-20 border-b border-slate-800/80 bg-slate-900/60 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3.5 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-emerald-500/40 bg-emerald-500/15 text-emerald-400">
              <Cuboid className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-base font-bold tracking-tight text-slate-100 sm:text-lg">Minecraft Sprite Sheet Studio</h1>
              <p className="text-xs text-slate-400">纯浏览器 · 图集生成 / 网格切分 / 逐格后处理 · 16/32/64</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 font-mono text-xs text-emerald-300">
              {PROVIDER_LABELS[settings.active]}
            </span>
            <button
              type="button"
              onClick={() => setShowSettings(true)}
              className="flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-950/60 px-3 py-2 text-xs font-medium text-slate-200 transition hover:border-emerald-500/60 hover:text-emerald-300"
            >
              <Settings2 className="h-4 w-4" /> 设置
            </button>
            <a
              href="https://github.com/TansuoTro/pixelization"
              target="_blank"
              rel="noreferrer"
              className="hidden items-center gap-1.5 rounded-xl border border-slate-800 px-3 py-2 text-xs text-slate-400 transition hover:text-slate-100 sm:flex"
            >
              <Github className="h-4 w-4" /> 源码
            </a>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6">
        <SheetStudio settings={settings} onOpenSettings={() => setShowSettings(true)} />
      </main>

      <footer className="border-t border-slate-800/70 py-5 text-center text-[11px] text-slate-600">
        纯静态 Netlify 项目 · 所有图像处理都在你的浏览器内完成 · API Key 仅存于本机 localStorage
      </footer>

      {showSettings && (
        <SettingsModal settings={settings} onSave={handleSave} onClose={() => setShowSettings(false)} />
      )}
    </div>
  );
};

export default App;
