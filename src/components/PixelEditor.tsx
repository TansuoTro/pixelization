import React, { useCallback, useEffect, useRef, useState } from "react";
import { Download, Eraser, Grid3X3, Pencil, Pipette, Redo2, Undo2 } from "lucide-react";
import { b64DataUrl, download } from "./ui";
import { decodeToRaster, rasterToPngB64, type Raster } from "../core/image";

interface Props {
  imageB64: string;
  size: number;
  palette: string[];
}

type Tool = "pencil" | "eraser" | "eyedropper";

export const PixelEditor: React.FC<Props> = ({ imageB64, size, palette }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [raster, setRaster] = useState<Raster | null>(null);
  const [tool, setTool] = useState<Tool>("pencil");
  const [color, setColor] = useState(palette[0] || "#34d399");
  const [showGrid, setShowGrid] = useState(true);
  const [undo, setUndo] = useState<Uint8ClampedArray[]>([]);
  const [redo, setRedo] = useState<Uint8ClampedArray[]>([]);
  const [pngB64, setPngB64] = useState(imageB64);

  useEffect(() => {
    let active = true;
    decodeToRaster(imageB64).then((r) => {
      if (!active) return;
      setRaster(r);
      setPngB64(rasterToPngB64(r));
      setUndo([]);
      setRedo([]);
    });
    return () => {
      active = false;
    };
  }, [imageB64]);

  const paint = useCallback(
    (r: Raster) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.imageSmoothingEnabled = false;
      // Put the raster into a temp canvas then scale with nearest neighbour.
      const tmp = document.createElement("canvas");
      tmp.width = r.w;
      tmp.height = r.h;
      tmp.getContext("2d")?.putImageData(
        new ImageData(new Uint8ClampedArray(r.data), r.w, r.h),
        0,
        0
      );
      ctx.drawImage(tmp, 0, 0, canvas.width, canvas.height);
      if (showGrid && size <= 64) {
        ctx.strokeStyle = "rgba(148,163,184,0.22)";
        ctx.lineWidth = 1;
        const step = canvas.width / size;
        for (let i = 1; i < size; i += 1) {
          ctx.beginPath();
          ctx.moveTo(i * step, 0);
          ctx.lineTo(i * step, canvas.height);
          ctx.moveTo(0, i * step);
          ctx.lineTo(canvas.width, i * step);
          ctx.stroke();
        }
      }
    },
    [showGrid, size]
  );

  useEffect(() => {
    if (raster) paint(raster);
  }, [raster, paint]);

  const commit = (next: Raster) => {
    if (raster) setUndo((u) => [...u.slice(-19), new Uint8ClampedArray(raster.data)]);
    setRedo([]);
    setRaster(next);
    setPngB64(rasterToPngB64(next));
  };

  const hexToRgb = (hex: string): [number, number, number] => {
    const h = hex.replace("#", "");
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  };

  const handlePointer = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!raster) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = Math.floor(((e.clientX - rect.left) / rect.width) * raster.w);
    const y = Math.floor(((e.clientY - rect.top) / rect.height) * raster.h);
    if (x < 0 || y < 0 || x >= raster.w || y >= raster.h) return;
    const next = { w: raster.w, h: raster.h, data: new Uint8ClampedArray(raster.data) };
    const i = (y * raster.w + x) * 4;
    if (tool === "eyedropper") {
      const r = next.data[i];
      const g = next.data[i + 1];
      const b = next.data[i + 2];
      if (next.data[i + 3] > 0) setColor(`#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`);
      return;
    }
    if (tool === "eraser") {
      next.data[i] = 0;
      next.data[i + 1] = 0;
      next.data[i + 2] = 0;
      next.data[i + 3] = 0;
    } else {
      const [r, g, b] = hexToRgb(color);
      next.data[i] = r;
      next.data[i + 1] = g;
      next.data[i + 2] = b;
      next.data[i + 3] = 255;
    }
    commit(next);
  };

  const doUndo = () => {
    if (!raster || undo.length === 0) return;
    const prev = undo[undo.length - 1];
    setRedo((r) => [...r, new Uint8ClampedArray(raster.data)]);
    setUndo((u) => u.slice(0, -1));
    const next = { w: raster.w, h: raster.h, data: new Uint8ClampedArray(prev) };
    setRaster(next);
    setPngB64(rasterToPngB64(next));
  };

  const doRedo = () => {
    if (!raster || redo.length === 0) return;
    const nxt = redo[redo.length - 1];
    setUndo((u) => [...u, new Uint8ClampedArray(raster.data)]);
    setRedo((r) => r.slice(0, -1));
    const next = { w: raster.w, h: raster.h, data: new Uint8ClampedArray(nxt) };
    setRaster(next);
    setPngB64(rasterToPngB64(next));
  };

  const canvasSize = Math.max(192, Math.min(384, size * 12));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {(
          [
            ["pencil", Pencil, "画笔"],
            ["eraser", Eraser, "橡皮"],
            ["eyedropper", Pipette, "吸管"],
          ] as const
        ).map(([id, Icon, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTool(id)}
            className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs transition ${
              tool === id
                ? "bg-emerald-500/15 border-emerald-500 text-emerald-300"
                : "bg-slate-950/60 border-slate-800 text-slate-400 hover:border-slate-700"
            }`}
          >
            <Icon className="h-3.5 w-3.5" /> {label}
          </button>
        ))}
        <input
          type="color"
          value={color}
          onChange={(e) => setColor(e.target.value)}
          className="h-8 w-9 cursor-pointer rounded border border-slate-700 bg-transparent"
          title="颜色"
        />
        <div className="flex flex-wrap gap-1">
          {palette.slice(0, 16).map((hex) => (
            <button
              key={hex}
              type="button"
              onClick={() => setColor(hex)}
              title={hex}
              className="h-6 w-6 rounded border border-slate-700"
              style={{ backgroundColor: hex }}
            />
          ))}
        </div>
        <div className="ml-auto flex items-center gap-1">
          <button type="button" onClick={() => setShowGrid((v) => !v)} title="网格" className="rounded-lg border border-slate-800 p-1.5 text-slate-400 hover:text-slate-100">
            <Grid3X3 className="h-3.5 w-3.5" />
          </button>
          <button type="button" onClick={doUndo} title="撤销" className="rounded-lg border border-slate-800 p-1.5 text-slate-400 hover:text-slate-100">
            <Undo2 className="h-3.5 w-3.5" />
          </button>
          <button type="button" onClick={doRedo} title="重做" className="rounded-lg border border-slate-800 p-1.5 text-slate-400 hover:text-slate-100">
            <Redo2 className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => download(b64DataUrl(pngB64), `edited_${size}x${size}.png`)}
            className="flex items-center gap-1 rounded-lg border border-slate-800 px-2 py-1.5 text-xs text-slate-300 hover:text-emerald-300"
          >
            <Download className="h-3.5 w-3.5" /> 导出 PNG
          </button>
        </div>
      </div>
      <div className="flex justify-center rounded-xl border border-slate-800 bg-[#1b1b24] p-3">
        <canvas
          ref={canvasRef}
          width={canvasSize}
          height={canvasSize}
          onPointerDown={handlePointer}
          onPointerMove={(e) => {
            if (e.buttons === 1 && tool !== "eyedropper") handlePointer(e);
          }}
          className="pixelated max-w-full cursor-crosshair touch-none rounded"
          style={{ imageRendering: "pixelated" }}
        />
      </div>
    </div>
  );
};
