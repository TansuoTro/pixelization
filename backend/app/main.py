"""FastAPI application entry point for the Minecraft Texture Generator backend."""

from __future__ import annotations

import logging
import os
import time
from collections import defaultdict, deque
from typing import Annotated, Literal

from fastapi import FastAPI, File, Form, HTTPException, Request, Response, UploadFile, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.config import get_settings
from app.pixel_pipeline import (
    base64_to_image,
    extract_hex_palette,
    image_to_base64_png,
    image_to_png_bytes,
    process_texture,
    validate_and_open_image_bytes,
    wrap_prompt,
)
from app.providers.registry import get_provider, list_providers
from app.sheet_pipeline import (
    RESAMPLE_LABELS,
    build_sheet_zip,
    process_sheet,
)
from app.sheet_prompts import (
    DEFAULT_ITEMS,
    GTCEU_STEEL_ITEMS,
    STYLE_PRESETS,
    build_reference_guidance,
    build_sheet_prompt,
)
from app.schemas import (
    BuildSheetPromptRequest,
    BuildSheetPromptResponse,
    GenerateResponse,
    ProviderId,
    ProvidersResponse,
    ReprocessRequest,
    SheetGenerateRequest,
    SheetGenerateResponse,
    SheetProcessRequest,
    SheetProcessResponse,
    SheetZipRequest,
    TargetSize,
    TextureMode,
)

logger = logging.getLogger(__name__)

ALLOWED_IMAGE_CONTENT_TYPES = {
    "image/png",
    "image/jpeg",
    "image/jfif",
    "image/jiff",
    "image/pjpeg",
    "image/webp",
    "image/bmp",
    "image/gif",
    "application/octet-stream",
    "",
}
ALLOWED_IMAGE_EXTENSIONS = {
    ".png",
    ".jpg",
    ".jpeg",
    ".jfif",
    ".jiff",
    ".pjpeg",
    ".pjp",
    ".webp",
    ".bmp",
    ".gif",
}

settings = get_settings()

# TODO(security): Add OAuth2 / OIDC authentication & MFA if deploying as a multi-tenant public SaaS.
# Currently designed as a single-user / local studio container tool using the BFF pattern.
app = FastAPI(
    title=settings.app_name,
    version="1.0.0",
    description=(
        "Converts text prompts and optional reference images into crisp 16x16, 32x32, and 64x64 "
        "Minecraft item and block textures."
    ),
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type", "Accept"],
)

# Simple sliding-window rate limiter per client IP.  Only the TWO endpoints that
# actually spend money on AI inference are limited; reprocessing an already
# generated atlas must stay free and responsive for real-time parameter tweaking.
_REQUEST_TIMESTAMPS: dict[str, deque[float]] = defaultdict(deque)
_RATE_LIMITED_PATHS = {"/api/generate", "/api/generate_sheet"}


@app.middleware("http")
async def security_headers_and_rate_limit_middleware(request: Request, call_next) -> Response:
    """Enforce HTTP method allow-list, per-IP rate limiting, and strict security headers."""
    if request.method not in {"GET", "POST", "OPTIONS", "HEAD"}:
        return JSONResponse(
            status_code=status.HTTP_405_METHOD_NOT_ALLOWED,
            content={"detail": "HTTP method not allowed."},
        )

    if request.url.path in _RATE_LIMITED_PATHS:
        client_ip = request.client.host if request.client else "127.0.0.1"
        now = time.monotonic()
        bucket = _REQUEST_TIMESTAMPS[client_ip]
        while bucket and (now - bucket[0]) > 60.0:
            bucket.popleft()

        limit = get_settings().rate_limit_per_minute
        if len(bucket) >= limit:
            return JSONResponse(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                content={"detail": "Rate limit exceeded. Please wait before generating more textures."},
            )
        bucket.append(now)

    response: Response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
    response.headers["Cache-Control"] = "no-store"
    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; img-src 'self' data: blob:; style-src 'self'; "
        "script-src 'self'; object-src 'none'; frame-ancestors 'none';"
    )
    return response


@app.get("/api/health")
async def health_check() -> dict[str, str]:
    """Return service health status."""
    return {"status": "ok"}


@app.get("/api/providers", response_model=ProvidersResponse)
async def get_available_providers() -> ProvidersResponse:
    """List all supported AI inference providers and whether each is configured."""
    return list_providers()


async def _validate_uploaded_reference_image(upload: UploadFile):
    """Validate uploaded reference image MIME type, extension, byte size, and magic header."""
    # TODO(security): Integrate an external malware/CDR scanner if accepting untrusted public file uploads.
    content_type = (upload.content_type or "").lower().strip()
    if content_type not in ALLOWED_IMAGE_CONTENT_TYPES and not content_type.startswith("image/"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Unsupported image MIME type. Allowed: PNG, JPEG, JFIF/JIFF, WEBP, BMP, GIF.",
        )

    if upload.filename:
        safe_name = os.path.basename(upload.filename)
        _, ext = os.path.splitext(safe_name.lower())
        if ext and ext not in ALLOWED_IMAGE_EXTENSIONS:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Unsupported file extension. Allowed: .png, .jpg, .jpeg, .jfif, .jiff, .webp, .bmp, .gif.",
            )

    max_bytes = get_settings().max_upload_bytes
    raw_bytes = await upload.read(max_bytes + 1)
    if len(raw_bytes) > max_bytes:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"Reference image exceeds maximum size of {max_bytes // (1024 * 1024)} MB.",
        )

    try:
        return validate_and_open_image_bytes(raw_bytes)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc


@app.post("/api/generate", response_model=GenerateResponse)
async def generate_texture(
    prompt: Annotated[
        str,
        Form(max_length=600, description="Text description of the Minecraft item or block (optional for upload_only)."),
    ] = "",
    mode: Annotated[TextureMode, Form(description="'item' (transparent sprite) or 'block' (seamless tile).")] = TextureMode.ITEM,
    size: Annotated[int, Form(description="Target pixel resolution: 16, 32, or 64.")] = 16,
    provider: Annotated[ProviderId | None, Form(description="AI provider ID override.")] = None,
    strength: Annotated[float, Form(ge=0.05, le=1.0, description="Reference image denoising strength.")] = 0.75,
    palette_colors: Annotated[int, Form(ge=2, le=64, description="Number of colors for MedianCut quantization.")] = 24,
    alpha_threshold: Annotated[int, Form(ge=1, le=254, description="Binary alpha threshold (0-254).")] = 128,
    response_format: Annotated[Literal["json", "png"], Form(description="Return JSON metadata + base64 or direct PNG stream.")] = "json",
    reference_image: Annotated[UploadFile | None, File(description="Optional reference or custom image (.png, .jpg, .jfif, .jiff, .webp).")] = None,
):
    """Generate or process a Minecraft item or block texture and apply the strict pixel-art pipeline."""
    if size not in (16, 32, 64):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid target size. Must be 16, 32, or 64.",
        )
    target_size: TargetSize = size  # type: ignore[assignment]

    ref_pil = None
    if reference_image is not None and reference_image.filename:
        ref_pil = await _validate_uploaded_reference_image(reference_image)

    try:
        active_provider = get_provider(provider)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc

    cleaned_prompt = prompt.strip()
    if active_provider.provider_id == "upload_only":
        if ref_pil is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Please upload an image (.jfif, .jiff, .png, .jpg, .webp) to run the pixel pipeline without AI.",
            )
        wrapped = "Direct custom image upload (AI generation skipped — ran rembg + binary alpha + Nearest-Neighbor + MedianCut pipeline)"
    else:
        if not cleaned_prompt:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Prompt cannot be empty when using an AI provider.",
            )
        wrapped = wrap_prompt(cleaned_prompt, mode=mode)

    try:
        raw_image = await active_provider.generate(
            wrapped_prompt=wrapped,
            mode=mode,
            reference_image=ref_pil,
            strength=strength,
        )
        processed_image = process_texture(
            image=raw_image,
            mode=mode,
            target_size=target_size,
            palette_colors=palette_colors,
            alpha_threshold=alpha_threshold,
            strip_background=(mode == TextureMode.ITEM),
        )
    except HTTPException:
        raise
    except Exception as exc:
        err_msg = str(exc).strip()
        if hasattr(exc, "response") and getattr(exc, "response", None) is not None:
            resp_obj = getattr(exc, "response")
            try:
                err_msg = f"HTTP {resp_obj.status_code}: {resp_obj.text[:400]}"
            except Exception:
                pass
        logger.error(
            "Texture generation failed with provider %s (%s): %s",
            active_provider.provider_id,
            exc.__class__.__name__,
            err_msg,
        )
        detail_msg = (
            f"Provider '{active_provider.name}' error: {err_msg}"
            if err_msg
            else f"Failed to generate texture from '{active_provider.name}'."
        )
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=detail_msg,
        ) from exc

    if response_format == "png":
        png_bytes = image_to_png_bytes(processed_image)
        return Response(
            content=png_bytes,
            media_type="image/png",
            headers={
                "Content-Disposition": f'attachment; filename="mc_{mode.value}_{target_size}x{target_size}.png"',
                "X-Content-Type-Options": "nosniff",
            },
        )

    return GenerateResponse(
        processed_image_b64=image_to_base64_png(processed_image),
        raw_image_b64=image_to_base64_png(raw_image),
        wrapped_prompt=wrapped,
        mode=mode,
        size=target_size,
        provider=active_provider.provider_id,
        palette_colors=palette_colors,
        palette=extract_hex_palette(processed_image),
    )


@app.post("/api/reprocess", response_model=GenerateResponse)
async def reprocess_existing_image(payload: ReprocessRequest) -> GenerateResponse:
    """Re-run the pixel pipeline on an existing raw high-res image (e.g. when changing 16/32/64 or palette size)."""
    try:
        raw_image = base64_to_image(payload.raw_image_b64)
        processed = process_texture(
            image=raw_image,
            mode=payload.mode,
            target_size=payload.size,
            palette_colors=payload.palette_colors,
            alpha_threshold=payload.alpha_threshold,
            strip_background=(payload.mode == TextureMode.ITEM and payload.strip_background),
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc
    except Exception as exc:
        logger.error("Reprocessing failed: %s", exc.__class__.__name__)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Could not reprocess the provided image payload.",
        ) from exc

    return GenerateResponse(
        processed_image_b64=image_to_base64_png(processed),
        raw_image_b64=image_to_base64_png(raw_image),
        wrapped_prompt="",
        mode=payload.mode,
        size=payload.size,
        provider="mock",
        palette_colors=payload.palette_colors,
        palette=extract_hex_palette(processed),
    )


# --------------------------------------------------------------------------- #
# Sprite-sheet / atlas batch studio
# --------------------------------------------------------------------------- #


def _normalize_items(items: list[str], rows: int, cols: int) -> list[str]:
    """Keep the item list exactly the size of the grid."""
    cleaned = [str(i).strip() for i in items if str(i).strip()] or list(DEFAULT_ITEMS)
    n = rows * cols
    return (cleaned[:n] + [f"Item {k + 1}" for k in range(n)])[:n]


def _decode_reference_image(b64: str | None):
    """Validate + decode an optional base64 reference image for img2img."""
    if not b64 or not b64.strip():
        return None
    cleaned = b64.strip()
    if "," in cleaned and cleaned.startswith("data:"):
        cleaned = cleaned.split(",", 1)[1]

    # Cap the payload before decoding (base64 is ~4/3 of the decoded bytes).
    max_b64_len = int(get_settings().max_upload_bytes * 4 / 3) + 4096
    if len(cleaned) > max_b64_len:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="Reference image exceeds the maximum upload size.",
        )
    try:
        return base64_to_image(cleaned)
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid reference image: {exc}",
        ) from exc


@app.get("/api/sheet_options")
async def sheet_options() -> dict:
    """Expose every selectable sheet option so the UI has a single source of truth."""
    return {
        "styles": [
            {"id": key, "label": value["label"]}
            for key, value in STYLE_PRESETS.items()
        ],
        "resample_methods": RESAMPLE_LABELS,
        "default_items": DEFAULT_ITEMS,
        "gtceu_steel_items": GTCEU_STEEL_ITEMS,
        "backgrounds": ["white", "transparent", "black", "magenta", "green"],
        "background_modes": [
            "auto", "white", "black", "magenta", "green",
            "transparent", "none", "rembg",
        ],
        "cell_modes": ["item", "block"],
        "grid_presets": [
            {"label": "2 x 2 (4)", "rows": 2, "cols": 2},
            {"label": "3 x 3 (9)", "rows": 3, "cols": 3},
            {"label": "4 x 4 (16)", "rows": 4, "cols": 4},
            {"label": "4 x 5 (20)", "rows": 4, "cols": 5},
            {"label": "5 x 5 (25)", "rows": 5, "cols": 5},
            {"label": "4 x 6 (24)", "rows": 4, "cols": 6},
            {"label": "6 x 6 (36)", "rows": 6, "cols": 6},
        ],
    }


@app.post("/api/build_sheet_prompt", response_model=BuildSheetPromptResponse)
async def build_sheet_prompt_endpoint(
    payload: BuildSheetPromptRequest,
) -> BuildSheetPromptResponse:
    """Preview the exact prompt that will be sent. No AI call, no cost."""
    items = _normalize_items(payload.items, payload.grid_rows, payload.grid_cols)
    guidance = (
        build_reference_guidance(
            payload.reference_strength, payload.reference_instructions
        )
        if payload.has_reference
        else ""
    )
    prompt = build_sheet_prompt(
        items=items,
        grid_rows=payload.grid_rows,
        grid_cols=payload.grid_cols,
        style=payload.style,
        background=payload.background,
        extra_instructions=payload.extra_instructions,
        custom_prompt=payload.custom_prompt,
        reference_guidance=guidance,
    )
    return BuildSheetPromptResponse(
        prompt=prompt,
        items=items,
        grid_rows=payload.grid_rows,
        grid_cols=payload.grid_cols,
        has_reference=payload.has_reference,
    )


@app.post("/api/generate_sheet", response_model=SheetGenerateResponse)
async def generate_sheet(payload: SheetGenerateRequest) -> SheetGenerateResponse:
    """Render a full atlas with ONE AI call, then split + process every cell."""
    items = _normalize_items(payload.items, payload.grid_rows, payload.grid_cols)
    ref_pil = _decode_reference_image(payload.reference_image_b64)
    has_reference = ref_pil is not None

    guidance = (
        build_reference_guidance(
            payload.reference_strength, payload.reference_instructions
        )
        if has_reference
        else ""
    )
    prompt = build_sheet_prompt(
        items=items,
        grid_rows=payload.grid_rows,
        grid_cols=payload.grid_cols,
        style=payload.style,
        background=payload.background,
        extra_instructions=payload.extra_instructions,
        custom_prompt=payload.custom_prompt,
        reference_guidance=guidance,
    )
    params = payload.process.model_copy(
        update={"grid_rows": payload.grid_rows, "grid_cols": payload.grid_cols}
    )

    try:
        active_provider = get_provider(payload.provider)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)
        ) from exc

    if has_reference and not active_provider.supports_img2img:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"Provider '{active_provider.name}' does not support reference "
                "images (img2img). Remove the reference image or switch provider."
            ),
        )

    try:
        raw_image = await active_provider.generate(
            wrapped_prompt=prompt,
            mode=TextureMode.ITEM,
            reference_image=ref_pil,
            strength=payload.reference_strength,
        )
        result = process_sheet(
            raw_image, params, items, overrides=payload.cell_overrides
        )
    except HTTPException:
        raise
    except Exception as exc:
        err_msg = str(exc).strip()
        if hasattr(exc, "response") and getattr(exc, "response", None) is not None:
            resp_obj = getattr(exc, "response")
            try:
                err_msg = f"HTTP {resp_obj.status_code}: {resp_obj.text[:400]}"
            except Exception:
                pass
        logger.error(
            "Sheet generation failed with provider %s (%s): %s",
            active_provider.provider_id,
            exc.__class__.__name__,
            err_msg,
        )
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=(
                f"Provider '{active_provider.name}' error: {err_msg}"
                if err_msg
                else f"Failed to generate atlas from '{active_provider.name}'."
            ),
        ) from exc

    return SheetGenerateResponse(
        **result.model_dump(),
        wrapped_prompt=prompt,
        provider=active_provider.provider_id,
        used_reference=has_reference,
    )


@app.post("/api/process_sheet", response_model=SheetProcessResponse)
async def process_sheet_endpoint(
    payload: SheetProcessRequest,
) -> SheetProcessResponse:
    """Re-split / re-process an existing atlas. NEVER calls the AI model.

    This is the real-time knob endpoint: once the atlas exists, the client can
    change size / resampling / palette / background / grid detection freely.
    """
    try:
        raw_image = base64_to_image(payload.raw_sheet_b64)
        return process_sheet(
            raw_image,
            payload.process,
            payload.items or list(DEFAULT_ITEMS),
            overrides=payload.cell_overrides,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)
        ) from exc
    except Exception as exc:
        logger.error("Sheet processing failed: %s", exc.__class__.__name__)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Could not process the provided atlas: {exc}",
        ) from exc


@app.post("/api/export_sheet_zip")
async def export_sheet_zip(payload: SheetZipRequest) -> Response:
    """Package the processed cells as a resource-pack-ready ZIP of PNGs."""
    try:
        raw_image = base64_to_image(payload.raw_sheet_b64)
        result = process_sheet(
            raw_image,
            payload.process,
            payload.items or list(DEFAULT_ITEMS),
            overrides=payload.cell_overrides,
        )
        zip_bytes = build_sheet_zip(result)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)
        ) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Could not build the sheet archive: {exc}",
        ) from exc

    return Response(
        content=zip_bytes,
        media_type="application/zip",
        headers={
            "Content-Disposition": 'attachment; filename="mc_sprite_sheet.zip"',
            "X-Content-Type-Options": "nosniff",
        },
    )

