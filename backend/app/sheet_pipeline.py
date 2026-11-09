"""Sprite-sheet (atlas) segmentation and per-cell pixel-art post-processing.

Pipeline order (important -- we split FIRST, then downsample each cell):

1. Background detection on the WHOLE atlas.  GPT Image 2 style outputs usually
   have a solid WHITE (or chroma) backdrop, not real alpha.  We colour-key it
   and keep only background regions CONNECTED TO THE IMAGE BORDER (a flood fill),
   so white highlights *inside* a sprite are never eaten.
2. Grid line detection.  A background-projection profile is used to refine the
   expected cell boundaries onto the actual white gutters.  Falls back to a
   perfectly uniform grid when detection is unreliable.
3. Per cell: inset crop -> background mask -> trim to content bbox -> pad to a
   square -> resample to 16/32/64 with a SELECTABLE filter -> binary alpha ->
   MedianCut quantisation.
4. Compose a contact-sheet preview with grid lines, labels and empty-cell flags.

Every knob lives in ``SheetProcessParams``; changing one of them only re-runs
this function on the already-generated atlas -- it never calls the AI again.
"""

from __future__ import annotations

import hashlib
import io
from typing import Iterable

import numpy as np
from PIL import Image, ImageDraw

from app.pixel_pipeline import (
    apply_binary_alpha_threshold,
    base64_to_image,
    extract_hex_palette,
    image_to_base64_png,
    image_to_png_bytes,
    quantize_with_binary_alpha,
    remove_background,
)
from app.schemas import (
    GridLines,
    SheetCell,
    SheetProcessParams,
    SheetProcessResponse,
    TargetSize,
)
from app.sheet_prompts import slugify

# --------------------------------------------------------------------------- #
# Resampling filters (exposed to the UI)
# --------------------------------------------------------------------------- #

RESAMPLE_METHODS: dict[str, int] = {
    "nearest": Image.Resampling.NEAREST,
    "bilinear": Image.Resampling.BILINEAR,
    "bicubic": Image.Resampling.BICUBIC,
    "lanczos": Image.Resampling.LANCZOS,
    "box": Image.Resampling.BOX,
    "hamming": Image.Resampling.HAMMING,
}

RESAMPLE_LABELS: dict[str, str] = {
    "nearest": "Nearest Neighbor (crisp pixel art)",
    "bilinear": "Bilinear (soft)",
    "bicubic": "Bicubic (smooth)",
    "lanczos": "Lanczos (high-quality downscale)",
    "box": "Box (area average)",
    "hamming": "Hamming (sharp-ish)",
}

_KEY_COLORS: dict[str, tuple[int, int, int]] = {
    "white": (255, 255, 255),
    "black": (0, 0, 0),
    "magenta": (255, 0, 255),
    "green": (0, 255, 0),
}


def _resampling(name: str) -> int:
    return RESAMPLE_METHODS.get(name, Image.Resampling.NEAREST)


# --------------------------------------------------------------------------- #
# 1. Background detection
# --------------------------------------------------------------------------- #

def _border_connected(mask: np.ndarray) -> np.ndarray:
    """Keep only mask components that touch the image border (flood fill).

    8-connectivity is used so diagonal gaps in a slightly noisy backdrop still
    connect.  Interior same-colour regions (e.g. white highlights on a sprite)
    are deliberately preserved as content.
    """
    try:
        from scipy import ndimage  # type: ignore[import-untyped]
    except Exception:
        return mask

    if not bool(mask.any()):
        return np.zeros_like(mask, dtype=bool)

    labelled, count = ndimage.label(mask, structure=np.ones((3, 3), dtype=int))
    if count == 0:
        return np.zeros_like(mask, dtype=bool)

    border = np.concatenate(
        (labelled[0, :], labelled[-1, :], labelled[:, 0], labelled[:, -1])
    )
    keep = np.unique(border)
    keep = keep[keep != 0]
    if keep.size == 0:
        return np.zeros_like(mask, dtype=bool)
    # OR-ing a handful of labels is much faster than np.isin over ~1M pixels.
    out = np.zeros_like(mask, dtype=bool)
    for label in keep:
        out |= labelled == label
    return out


def _corner_color(rgb: np.ndarray) -> np.ndarray:
    """Median colour of small patches at the four corners."""
    h, w = rgb.shape[:2]
    p = max(1, min(12, h // 12, w // 12))
    patches = [
        rgb[:p, :p].reshape(-1, 3),
        rgb[:p, w - p :].reshape(-1, 3),
        rgb[h - p :, :p].reshape(-1, 3),
        rgb[h - p :, w - p :].reshape(-1, 3),
    ]
    return np.median(np.concatenate(patches, axis=0), axis=0)


def build_background_mask(
    image: Image.Image, params: SheetProcessParams
) -> tuple[np.ndarray, tuple[int, int, int]]:
    """Return (bool background mask, background colour)."""
    arr = np.array(image.convert("RGBA"), dtype=np.uint8)
    h, w = arr.shape[:2]
    rgb = arr[:, :, :3].astype(np.int16)
    alpha = arr[:, :, 3]
    transparent = alpha < params.alpha_threshold
    tol = params.background_tolerance
    mode = params.background

    if mode == "none":
        # Full-bleed atlas (blocks / machine faces): nothing is background.
        return np.zeros((h, w), dtype=bool), (0, 0, 0)

    if mode == "transparent":
        return transparent.astype(bool), (255, 255, 255)

    if mode == "rembg":
        removed = remove_background(image)
        rm_alpha = np.array(removed.convert("RGBA"))[:, :, 3]
        return (rm_alpha < params.alpha_threshold), (255, 255, 255)

    if mode == "auto":
        # If the atlas already carries real alpha, prefer that over colour-keying.
        if float(transparent.mean()) > 0.05:
            return transparent.astype(bool), (255, 255, 255)
        bg_color = _corner_color(rgb)
    else:
        bg_color = np.array(_KEY_COLORS.get(mode, (255, 255, 255)), dtype=np.float32)

    # Max-channel distance is more stable than Euclidean for near-white backdrops.
    diff = np.abs(rgb - bg_color).max(axis=2)
    candidates = (diff <= tol) | transparent

    try:
        from scipy import ndimage  # type: ignore[import-untyped]

        candidates = ndimage.binary_closing(
            candidates,
            structure=np.ones((3, 3), dtype=bool),
            border_value=True,
        )
    except Exception:
        pass

    # binary_closing's erosion can shave the outermost ring even with
    # border_value=True; the atlas edge is background by construction, so give
    # the flood fill explicit seeds regardless of the filter's edge behaviour.
    candidates[0, :] = True
    candidates[-1, :] = True
    candidates[:, 0] = True
    candidates[:, -1] = True

    mask = _border_connected(candidates.astype(bool))
    # Also keep border-connected genuinely-transparent regions.
    mask = mask | (transparent & _border_connected(transparent))
    return mask.astype(bool), tuple(int(v) for v in bg_color)


# --------------------------------------------------------------------------- #
# 2. Grid line detection
# --------------------------------------------------------------------------- #

def _uniform_lines(length: int, count: int) -> list[int]:
    return [int(round(i * length / count)) for i in range(count + 1)]


def detect_grid_lines(
    bg_mask: np.ndarray, count: int, axis: str, enabled: bool = True
) -> tuple[list[int], bool]:
    """Refine expected cell boundaries onto the actual background gutters.

    The expected grid is a strong prior (we asked the model for an aligned grid),
    so for each interior boundary we only search a +/-30% window around it for the
    maximum of the smoothed background-projection profile.  Degenerate results
    fall back to a perfectly uniform split.
    """
    length = bg_mask.shape[1] if axis == "x" else bg_mask.shape[0]
    if count <= 1 or not enabled:
        return _uniform_lines(length, count), False

    profile = (
        bg_mask.mean(axis=0) if axis == "x" else bg_mask.mean(axis=1)
    ).astype(np.float32)

    k = max(3, (length // 200) * 2 + 1)  # odd
    kernel = np.ones(k, dtype=np.float32) / k
    pad = k // 2
    smoothed = np.convolve(np.pad(profile, pad, mode="edge"), kernel, mode="valid")

    step = length / count
    lines = [0]
    for i in range(1, count):
        expected = i * step
        half = max(2.0, step * 0.30)
        lo = int(max(lines[-1] + 1, expected - half))
        hi = int(min(length - 1, expected + half))
        if hi <= lo:
            lines.append(int(round(expected)))
        else:
            window = smoothed[lo : hi + 1]
            peak = float(window.max())
            # Take the CENTRE of the widest near-peak run (the gutter), not the
            # first peak sample -- a flat plateau would otherwise bias left.
            threshold = peak - max(0.01, peak * 0.02)
            above = window >= threshold
            runs: list[tuple[int, int]] = []
            start: int | None = None
            for j, flag in enumerate(above):
                if flag and start is None:
                    start = j
                if start is not None and (not flag or j == len(above) - 1):
                    end = j if (flag and j == len(above) - 1) else j - 1
                    runs.append((start, end))
                    start = None
            if runs:
                best = max(runs, key=lambda t: t[1] - t[0])
                lines.append(lo + (best[0] + best[1]) // 2)
            else:
                lines.append(lo + int(np.argmax(window)))
    lines.append(length)

    fixed: list[int] = []
    prev = -1
    for value in lines:
        value = int(min(max(value, prev + 1), length))
        fixed.append(value)
        prev = value
    fixed[-1] = length

    if any(fixed[i + 1] - fixed[i] < length / (count * 3) for i in range(count)):
        return _uniform_lines(length, count), False
    return fixed, True


# --------------------------------------------------------------------------- #
# 3. Per-cell processing
# --------------------------------------------------------------------------- #

def _pad_to_square(
    arr: np.ndarray, bg: np.ndarray, fill: np.ndarray
) -> tuple[np.ndarray, np.ndarray]:
    h, w = arr.shape[:2]
    side = max(h, w)
    if h == w and side > 0:
        return arr, bg
    side = max(side, 1)
    out = np.zeros((side, side, 4), dtype=np.uint8)
    out[:, :, :3] = fill
    out[:, :, 3] = 0
    out_bg = np.ones((side, side), dtype=bool)
    yoff = (side - h) // 2
    xoff = (side - w) // 2
    out[yoff : yoff + h, xoff : xoff + w] = arr
    out_bg[yoff : yoff + h, xoff : xoff + w] = bg
    return out, out_bg


def process_cell(
    cell: Image.Image,
    cell_bg: np.ndarray,
    params: SheetProcessParams,
    bg_color: tuple[int, int, int],
) -> tuple[Image.Image, dict]:
    """Split ONE atlas cell into a finished Minecraft texture."""
    arr = np.array(cell.convert("RGBA"), dtype=np.uint8, copy=True)
    h, w = arr.shape[:2]
    bg = cell_bg.astype(bool)

    if params.cell_mode == "block":
        # Full-bleed opaque tile: no background removal, no trim.
        bg = np.zeros((h, w), dtype=bool)

    content = ~bg
    content_ratio = float(content.mean())
    empty = content_ratio < 0.002

    bbox = [0, 0, w, h]
    if params.trim and params.cell_mode == "item" and content.any():
        ys, xs = np.where(content)
        pad = int(round(max(w, h) * params.trim_padding))
        x0 = max(0, int(xs.min()) - pad)
        x1 = min(w, int(xs.max()) + 1 + pad)
        y0 = max(0, int(ys.min()) - pad)
        y1 = min(h, int(ys.max()) + 1 + pad)
        arr = arr[y0:y1, x0:x1]
        bg = bg[y0:y1, x0:x1]
        bbox = [x0, y0, x1, y1]

    if content.any():
        fill = np.median(arr[~bg][:, :3], axis=0).astype(np.uint8) if (~bg).any() else np.array(bg_color, dtype=np.uint8)
    else:
        fill = np.array(bg_color, dtype=np.uint8)

    arr, bg = _pad_to_square(arr, bg, fill)

    # Alpha: background fully transparent, content fully opaque.  Background RGB
    # is filled with the median content colour so anti-aliasing resamplers do not
    # produce white/black halos at the sprite edge.
    arr[:, :, 3] = np.where(bg, 0, 255).astype(np.uint8)
    arr[bg, :3] = fill

    size: TargetSize = params.target_size
    img = Image.fromarray(arr, mode="RGBA").resize(
        (size, size), resample=_resampling(params.resample)
    )

    if params.binary_alpha:
        img = apply_binary_alpha_threshold(img, params.alpha_threshold)
    if params.quantize:
        # quantize_with_binary_alpha enforces binary alpha internally.
        img = quantize_with_binary_alpha(
            img, num_colors=params.palette_colors, alpha_threshold=params.alpha_threshold
        )

    meta = {
        "empty": bool(empty),
        "content_ratio": round(content_ratio, 5),
        "bbox": [int(v) for v in bbox],
    }
    return img, meta


# --------------------------------------------------------------------------- #
# 4. Contact-sheet preview
# --------------------------------------------------------------------------- #

def _checker_tile(size: int = 8) -> Image.Image:
    tile = Image.new("RGBA", (size * 2, size * 2), (58, 58, 68, 255))
    d = ImageDraw.Draw(tile)
    d.rectangle((0, 0, size - 1, size - 1), fill=(38, 38, 48, 255))
    d.rectangle((size, size, size * 2 - 1, size * 2 - 1), fill=(38, 38, 48, 255))
    return tile


def build_contact_sheet(
    images: list[Image.Image],
    cells: list[SheetCell],
    params: SheetProcessParams,
) -> str:
    """Compose all processed cells into a labelled preview atlas."""
    scale = params.contact_sheet_scale
    gap = 8
    label_h = 18
    rows, cols = params.grid_rows, params.grid_cols
    width = cols * (scale + gap) + gap
    height = rows * (scale + gap + label_h) + gap
    canvas = Image.new("RGBA", (width, height), (18, 18, 26, 255))
    draw = ImageDraw.Draw(canvas)
    tile = _checker_tile()

    for idx, (img, cell) in enumerate(zip(images, cells)):
        r, c = divmod(idx, cols)
        x = gap + c * (scale + gap)
        y = gap + r * (scale + gap + label_h)

        for ty in range(0, scale, 16):
            for tx in range(0, scale, 16):
                canvas.alpha_composite(tile, (x + tx, y + ty))

        disp = img.convert("RGBA").resize((scale, scale), Image.Resampling.NEAREST)
        canvas.alpha_composite(disp, (x, y))
        draw.rectangle(
            (x, y, x + scale - 1, y + scale - 1), outline=(90, 100, 120, 255)
        )

        label = f"{idx + 1}. {cell.name}"[:26]
        color = (248, 113, 113, 255) if cell.empty else (203, 213, 225, 255)
        draw.text((x, y + scale + 3), label, fill=color)
        if cell.empty:
            draw.text((x + 4, y + 4), "EMPTY", fill=(248, 113, 113, 255))
        if cell.overridden:
            draw.rectangle(
                (x + scale - 30, y + 4, x + scale - 4, y + 18),
                fill=(16, 185, 129, 230),
            )
            draw.text((x + scale - 27, y + 6), "PIN", fill=(6, 20, 16, 255))

    return image_to_base64_png(canvas)


# --------------------------------------------------------------------------- #
# Orchestration
# --------------------------------------------------------------------------- #

def _resolve_names(names: Iterable[str] | None, count: int) -> list[str]:
    cleaned = [str(n).strip() for n in (names or []) if str(n).strip()]
    cleaned = cleaned[:count]
    while len(cleaned) < count:
        cleaned.append(f"Item {len(cleaned) + 1}")
    return cleaned


def _normalize_overrides(
    raw: dict | None, count: int
) -> dict[int, SheetProcessParams]:
    """Coerce JSON ``{"3": {...}}`` overrides into ``{3: SheetProcessParams}``."""
    out: dict[int, SheetProcessParams] = {}
    for key, value in (raw or {}).items():
        try:
            idx = int(key)
        except (TypeError, ValueError):
            continue
        if not 0 <= idx < count:
            continue
        try:
            out[idx] = (
                value
                if isinstance(value, SheetProcessParams)
                else SheetProcessParams.model_validate(value)
            )
        except Exception:
            continue
    return out


def _bg_signature(params: SheetProcessParams) -> tuple:
    return (
        params.background,
        params.background_tolerance,
        params.alpha_threshold,
    )


# The whole-sheet background mask is by far the most expensive step (~240ms on
# a 1024px atlas) but it depends ONLY on the image pixels + structural params.
# Dragging size / resampling / palette / trim sliders must not recompute it.
_BG_CACHE: dict[tuple, tuple[np.ndarray, tuple[int, int, int]]] = {}
_BG_CACHE_MAX = 4


def _cached_background_mask(
    rgba: Image.Image, params: SheetProcessParams
) -> tuple[np.ndarray, tuple[int, int, int]]:
    arr = np.asarray(rgba, dtype=np.uint8)
    digest = hashlib.blake2b(arr.tobytes(), digest_size=16).hexdigest()
    key = (digest, arr.shape[0], arr.shape[1], _bg_signature(params))

    cached = _BG_CACHE.get(key)
    if cached is not None:
        return cached

    mask, color = build_background_mask(rgba, params)
    if len(_BG_CACHE) >= _BG_CACHE_MAX:
        _BG_CACHE.clear()
    _BG_CACHE[key] = (mask, color)
    return mask, color


def process_sheet(
    image: Image.Image,
    params: SheetProcessParams,
    names: Iterable[str] | None = None,
    overrides: dict | None = None,
) -> SheetProcessResponse:
    """Split + process an atlas.  Pure computation -- no AI inference.

    ``overrides`` maps a cell index to its OWN post-processing params.  Pinned
    cells ignore the global params entirely; unpinned cells use them.  Grid
    detection and the whole-sheet background mask are ALWAYS derived from the
    global params, because they define the atlas structure shared by all cells.
    A pinned cell may still change its background keying: in that case a local
    background mask is recomputed on that cell's crop.
    """
    rgba = image.convert("RGBA")
    sheet_w, sheet_h = rgba.size
    rows, cols = params.grid_rows, params.grid_cols
    count = rows * cols
    item_names = _resolve_names(names, count)
    cell_overrides = _normalize_overrides(overrides, count)

    # Atlas structure is global: one grid + one background mask for the sheet.
    bg_mask, bg_color = _cached_background_mask(rgba, params)
    x_lines, x_ok = detect_grid_lines(bg_mask, cols, "x", params.detect_grid)
    y_lines, y_ok = detect_grid_lines(bg_mask, rows, "y", params.detect_grid)

    images: list[Image.Image] = []
    cells: list[SheetCell] = []

    for idx in range(count):
        r, c = divmod(idx, cols)
        cell_params = cell_overrides.get(idx, params)
        overridden = idx in cell_overrides

        x0, x1 = x_lines[c], x_lines[c + 1]
        y0, y1 = y_lines[r], y_lines[r + 1]
        inset_x = int((x1 - x0) * cell_params.cell_inset)
        inset_y = int((y1 - y0) * cell_params.cell_inset)
        cx0, cx1 = x0 + inset_x, max(x0 + inset_x + 1, x1 - inset_x)
        cy0, cy1 = y0 + inset_y, max(y0 + inset_y + 1, y1 - inset_y)
        cx1, cy1 = min(cx1, sheet_w), min(cy1, sheet_h)

        cell_img = rgba.crop((cx0, cy0, cx1, cy1))
        if overridden and _bg_signature(cell_params) != _bg_signature(params):
            # This pinned cell wants different keying -> recompute locally.
            local_bg, local_bg_color = build_background_mask(cell_img, cell_params)
            cell_bg = local_bg
            cell_bg_color = local_bg_color
        else:
            cell_bg = bg_mask[cy0:cy1, cx0:cx1]
            cell_bg_color = bg_color

        processed, meta = process_cell(
            cell_img, cell_bg, cell_params, cell_bg_color
        )
        images.append(processed)

        name = item_names[idx]
        cells.append(
            SheetCell(
                index=idx,
                row=r,
                col=c,
                name=name,
                filename=f"{idx + 1:02d}_{slugify(name)}.png",
                image_b64=image_to_base64_png(processed),
                palette=extract_hex_palette(processed),
                empty=meta["empty"],
                content_ratio=meta["content_ratio"],
                bbox=meta["bbox"],
                overridden=overridden,
            )
        )

    preview = build_contact_sheet(images, cells, params)

    return SheetProcessResponse(
        raw_sheet_b64=image_to_base64_png(rgba),
        preview_b64=preview,
        sheet_width=sheet_w,
        sheet_height=sheet_h,
        grid_rows=rows,
        grid_cols=cols,
        grid_lines=GridLines(x=x_lines, y=y_lines, detected=bool(x_ok and y_ok)),
        cells=cells,
        resample=params.resample,
        target_size=params.target_size,
        background=params.background,
        overridden_indices=sorted(cell_overrides),
    )


def build_sheet_zip(
    response: SheetProcessResponse,
) -> bytes:
    """Package processed cells into a resource-pack-ready ZIP."""
    import zipfile

    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for cell in response.cells:
            img = base64_to_image(cell.image_b64)
            zf.writestr(f"textures/item/{cell.filename}", image_to_png_bytes(img))
        manifest = "\n".join(
            f"{c.index + 1:02d} | r{c.row + 1}c{c.col + 1} | {c.name} | {c.filename}"
            + ("  [PINNED]" if c.overridden else "")
            + ("  [EMPTY]" if c.empty else "")
            for c in response.cells
        )
        zf.writestr("manifest.txt", manifest + "\n")
    return buffer.getvalue()
