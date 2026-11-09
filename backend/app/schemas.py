"""Pydantic schemas for request validation and response serialization."""

from __future__ import annotations

from enum import Enum
from typing import Literal

from pydantic import BaseModel, Field


class TextureMode(str, Enum):
    """Supported Minecraft asset generation modes."""

    ITEM = "item"
    BLOCK = "block"


TargetSize = Literal[16, 32, 64]

ProviderId = Literal[
    "upload_only",
    "pollinations",
    "mock",
    "huggingface",
    "openai",
    "gemini",
    "replicate",
    "fal",
    "local_sd",
]


class ProviderInfo(BaseModel):
    """Metadata describing an inference provider and its availability."""

    id: ProviderId
    name: str
    description: str
    configured: bool
    supports_img2img: bool
    is_default: bool = False


class ProvidersResponse(BaseModel):
    """Response listing all supported AI generation providers."""

    default_provider: ProviderId
    providers: list[ProviderInfo]


class GenerateResponse(BaseModel):
    """Response returned after generating and post-processing a texture."""

    processed_image_b64: str = Field(
        ..., description="Base64-encoded PNG of the final pixel-art texture."
    )
    raw_image_b64: str = Field(
        ..., description="Base64-encoded PNG of the high-resolution image before pixel pipeline."
    )
    wrapped_prompt: str = Field(
        ..., description="Full prompt sent to the model after mode-specific wrapping."
    )
    mode: TextureMode
    size: TargetSize
    provider: ProviderId
    palette_colors: int = Field(
        ..., description="Number of palette colors used during MedianCut quantization."
    )
    palette: list[str] = Field(
        default_factory=list,
        description="Extracted hex colors (#RRGGBB) present in the final texture.",
    )


class ReprocessRequest(BaseModel):
    """Request to re-run the pixel pipeline on an existing raw image without re-invoking AI."""

    raw_image_b64: str = Field(
        ..., description="Base64-encoded PNG (with or without data URL prefix)."
    )
    mode: TextureMode = TextureMode.ITEM
    size: TargetSize = 16
    alpha_threshold: int = Field(default=128, ge=1, le=254)
    palette_colors: int = Field(default=24, ge=2, le=64)
    strip_background: bool = Field(
        default=True,
        description="Whether to run background removal when mode is 'item'.",
    )


# --------------------------------------------------------------------------- #
# Sprite-sheet / atlas batch generation
# --------------------------------------------------------------------------- #

ResampleMethod = Literal[
    "nearest", "bilinear", "bicubic", "lanczos", "box", "hamming"
]

BackgroundMode = Literal[
    "auto", "white", "black", "magenta", "green", "transparent", "none", "rembg"
]

SheetStyle = Literal[
    "item", "gtceu", "faithful", "block", "machine", "animation", "custom"
]

SheetCellMode = Literal["item", "block"]

SheetBackground = Literal["white", "transparent", "black", "magenta", "green"]


class SheetProcessParams(BaseModel):
    """All post-processing knobs. Changing any of them NEVER re-invokes the AI model."""

    grid_rows: int = Field(default=4, ge=1, le=8)
    grid_cols: int = Field(default=4, ge=1, le=8)
    target_size: TargetSize = 16
    resample: ResampleMethod = "nearest"
    palette_colors: int = Field(default=24, ge=2, le=64)
    alpha_threshold: int = Field(default=128, ge=1, le=254)
    quantize: bool = True
    binary_alpha: bool = True
    background: BackgroundMode = "auto"
    background_tolerance: int = Field(default=32, ge=0, le=255)
    cell_mode: SheetCellMode = "item"
    trim: bool = True
    trim_padding: float = Field(default=0.04, ge=0.0, le=0.5)
    cell_inset: float = Field(default=0.0, ge=0.0, le=0.25)
    detect_grid: bool = True
    contact_sheet_scale: int = Field(default=96, ge=32, le=256)


class SheetCell(BaseModel):
    """One processed sprite extracted from the atlas."""

    index: int
    row: int
    col: int
    name: str
    filename: str
    image_b64: str
    palette: list[str] = Field(default_factory=list)
    empty: bool = False
    content_ratio: float = 0.0
    bbox: list[int] = Field(default_factory=list)
    overridden: bool = Field(
        default=False,
        description="True when this cell uses its own pinned post-processing params.",
    )


class GridLines(BaseModel):
    """Detected cell boundaries, in source-image pixel coordinates."""

    x: list[int] = Field(default_factory=list)
    y: list[int] = Field(default_factory=list)
    detected: bool = False


class SheetProcessResponse(BaseModel):
    """Result of splitting + processing an atlas (no AI inference)."""

    raw_sheet_b64: str
    preview_b64: str
    sheet_width: int
    sheet_height: int
    grid_rows: int
    grid_cols: int
    grid_lines: GridLines
    cells: list[SheetCell]
    resample: ResampleMethod
    target_size: TargetSize
    background: BackgroundMode
    overridden_indices: list[int] = Field(
        default_factory=list,
        description="Cell indices pinned to their own post-processing params.",
    )


class BuildSheetPromptRequest(BaseModel):
    items: list[str] = Field(default_factory=list)
    grid_rows: int = Field(default=4, ge=1, le=8)
    grid_cols: int = Field(default=4, ge=1, le=8)
    style: SheetStyle = "item"
    background: SheetBackground = "white"
    extra_instructions: str = ""
    custom_prompt: str | None = None
    # A reference image changes the prompt (REFERENCE IMAGE block) even for a
    # preview-only request, so the UI can show the exact prompt that will be sent.
    has_reference: bool = False
    reference_strength: float = Field(default=0.75, ge=0.05, le=1.0)
    reference_instructions: str = ""


class BuildSheetPromptResponse(BaseModel):
    prompt: str
    items: list[str]
    grid_rows: int
    grid_cols: int
    has_reference: bool = False


class SheetGenerateRequest(BaseModel):
    """Generate a whole atlas with ONE AI call, then split + process it."""

    items: list[str] = Field(default_factory=list)
    grid_rows: int = Field(default=4, ge=1, le=8)
    grid_cols: int = Field(default=4, ge=1, le=8)
    style: SheetStyle = "item"
    background: SheetBackground = "white"
    extra_instructions: str = ""
    custom_prompt: str | None = None
    provider: ProviderId | None = None
    process: SheetProcessParams = Field(default_factory=SheetProcessParams)
    # Per-cell pinned overrides, keyed by cell index (JSON keys are strings).
    cell_overrides: dict[str, SheetProcessParams] = Field(default_factory=dict)
    # Optional reference image for img2img (OpenAI GPT Image 2 /images/edits).
    # Sent as base64 so the endpoint stays JSON and reuses the same validation.
    reference_image_b64: str | None = None
    reference_strength: float = Field(default=0.75, ge=0.05, le=1.0)
    reference_instructions: str = ""


class SheetGenerateResponse(SheetProcessResponse):
    wrapped_prompt: str
    provider: ProviderId
    used_reference: bool = False


class SheetProcessRequest(BaseModel):
    """Re-split / re-process an ALREADY generated atlas (no AI inference)."""

    raw_sheet_b64: str
    items: list[str] = Field(default_factory=list)
    process: SheetProcessParams = Field(default_factory=SheetProcessParams)
    cell_overrides: dict[str, SheetProcessParams] = Field(default_factory=dict)


class SheetZipRequest(BaseModel):
    raw_sheet_b64: str
    items: list[str] = Field(default_factory=list)
    process: SheetProcessParams = Field(default_factory=SheetProcessParams)
    cell_overrides: dict[str, SheetProcessParams] = Field(default_factory=dict)

