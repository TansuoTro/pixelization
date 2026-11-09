"""Sprite-sheet (atlas) prompt templates and builder.

Instead of asking a model for a single isolated icon, we ask it to render MANY
independent items inside ONE image on a strictly aligned grid.  The prompt is
split into:

* a FIXED base constraint block (format rules, art style, lighting, material
  language, background, anti-leakage rules) -- always appended, never dropped;
* ADJUSTABLE sections (item list, grid geometry, style preset, background
  colour, extra instructions, or a full custom override).

The grid section describes each cell's exact position (row/column + corner/edge
hints) and provides an ASCII cell-number map, because diffusion/image models
follow explicit spatial descriptions far better than "generate 16 items".
"""

from __future__ import annotations

import re
from typing import Literal

SheetStyle = Literal[
    "item", "gtceu", "faithful", "block", "machine", "animation", "custom"
]
SheetBackground = Literal["white", "transparent", "black", "magenta", "green"]

# --------------------------------------------------------------------------- #
# Adjustable style presets
# --------------------------------------------------------------------------- #

STYLE_PRESETS: dict[str, dict[str, str]] = {
    "item": {
        "label": "Vanilla Item Sheet",
        "header": "Create a Minecraft Java Edition style pixel art item sprite sheet.",
        "art_style": (
            "Authentic Minecraft inventory item texture style.\n"
            "Strict pixel art aesthetic.\n"
            "Crisp square pixel clusters.\n"
            "Hard pixel edges, no anti-aliasing.\n"
            "Limited color palette.\n"
            "Consistent pixel density.\n"
            "Consistent lighting and shading.\n"
            "Simple readable silhouettes.\n"
            "No photorealism.\n"
            "No 3D rendering.\n"
            "No smooth gradients."
        ),
        "material_language": (
            "Copper: warm orange and reddish brown.\n"
            "Iron: neutral gray.\n"
            "Steel: dark blue-gray.\n"
            "Gold: saturated golden yellow.\n"
            "Tin: pale silvery gray.\n"
            "Dust/powder forms share the same base hue as their ingot counterpart."
        ),
        "lighting": (
            "Consistent top-left light source.\n"
            "Consistent shading direction.\n"
            "Consistent highlight intensity across every cell."
        ),
        "cell_note": "one unique item icon per cell, centered",
    },
    "gtceu": {
        "label": "GTCEu Industrial Atlas",
        "header": (
            "Create a professional Minecraft GTCEu-style industrial item sprite atlas."
        ),
        "art_style": (
            "Inspired by GregTech CEu and classic Minecraft industrial mod texture design.\n"
            "Vanilla Minecraft pixel art proportions.\n"
            "Industrial, technical and mechanical appearance.\n"
            "Strong readable silhouettes at 16x16 resolution.\n"
            "Carefully designed pixel clusters.\n"
            "Limited and coherent color palette.\n"
            "Metallic highlights and dark pixel shadows.\n"
            "Consistent pixel density and object scale.\n"
            "No anti-aliasing.\n"
            "No smooth gradients.\n"
            "No realistic photography.\n"
            "No excessive visual details."
        ),
        "material_language": (
            "MATERIAL LANGUAGE (keep these colour identities consistent for EVERY item):\n"
            "Copper: warm orange and reddish brown.\n"
            "Iron: neutral gray.\n"
            "Steel: dark blue-gray.\n"
            "Aluminium: pale silver.\n"
            "Titanium: cool gray with slight blue tint.\n"
            "Tungsten: dark charcoal.\n"
            "Gold: saturated golden yellow."
        ),
        "lighting": (
            "Consistent top-left light source.\n"
            "Consistent shading direction.\n"
            "Consistent highlight intensity."
        ),
        "cell_note": "one unique industrial item icon per cell, centered",
    },
    "faithful": {
        "label": "Faithful (Vanilla++ Res)",
        "header": (
            "Create a Faithful-style Minecraft item sprite sheet: the original vanilla "
            "design language kept recognisable but rendered with slightly higher pixel detail."
        ),
        "art_style": (
            "Vanilla Minecraft design language, recognisable silhouettes.\n"
            "Clean pixel art with slightly richer detail than 16x16 vanilla.\n"
            "Hard pixel edges, no anti-aliasing.\n"
            "Limited, coherent color palette.\n"
            "Consistent lighting, shading and pixel density.\n"
            "No photorealism, no 3D rendering, no smooth gradients."
        ),
        "material_language": (
            "Metals keep their canonical Minecraft hues (iron gray, gold yellow, "
            "copper orange, diamond cyan)."
        ),
        "lighting": (
            "Consistent top-left light source and identical highlight strength in every cell."
        ),
        "cell_note": "one unique item icon per cell, centered",
    },
    "block": {
        "label": "Block Texture Atlas",
        "header": (
            "Create a Minecraft Java Edition block texture atlas: a grid of seamless, "
            "tileable block textures (ore, stone, soil, metal blocks, machine casings)."
        ),
        "art_style": (
            "Each cell is a full-bleed seamless tileable texture, NOT an item icon.\n"
            "No drop shadows, no object silhouettes, no perspective.\n"
            "Flat orthographic 2D pattern that repeats cleanly at every edge.\n"
            "Strict pixel art, crisp square pixel clusters, hard edges.\n"
            "No anti-aliasing, no smooth gradients, no photorealism."
        ),
        "material_language": (
            "Stone/ore share a coherent gray base; metal blocks share a coherent "
            "brushed-metal palette; each tile uses a limited palette."
        ),
        "lighting": (
            "Flat even lighting inside each tile; no directional cast shadows."
        ),
        "cell_note": "one seamless tileable block texture filling the ENTIRE cell",
    },
    "machine": {
        "label": "Machine Texture Set",
        "header": (
            "Create a Minecraft technology-mod machine texture set: the SIX faces of ONE "
            "machine (front, back, left, right, top, bottom) plus control-panel detail."
        ),
        "art_style": (
            "Every cell is a full-bleed machine face texture, not an item icon.\n"
            "The SAME machine casing material, colour and structure across all faces.\n"
            "Front face contains the active panel / interface; other faces are casing.\n"
            "Strict pixel art, hard pixel edges, no anti-aliasing.\n"
            "No 3D perspective, no photorealism, no smooth gradients."
        ),
        "material_language": (
            "Consistent dark blue-gray metal casing with a single accent colour for "
            "the active interface; identical screw/rivet detail on every face."
        ),
        "lighting": (
            "Flat even lighting; consistent highlight direction on all six faces."
        ),
        "cell_note": "one machine face filling the ENTIRE cell",
    },
    "animation": {
        "label": "Animation Sprite Sheet",
        "header": (
            "Create a Minecraft pixel-art animation sprite sheet for a glowing core / "
            "flame / electric arc / working-machine effect."
        ),
        "art_style": (
            "Each cell is ONE consecutive animation frame, same object, same size, "
            "same position within its cell.\n"
            "Frames progress smoothly and continuously (no jumps in silhouette or hue).\n"
            "Strict pixel art, hard pixel edges, no anti-aliasing.\n"
            "Limited coherent palette, no photorealism, no smooth gradients.\n"
            "ALL cells must be identical in size so frames can be played in order."
        ),
        "material_language": (
            "One fixed palette for the whole sequence; brightness/energy is the only "
            "thing that changes between frames."
        ),
        "lighting": (
            "Identical light source in every frame; only the emissive core changes."
        ),
        "cell_note": "one animation frame per cell, identical framing and scale",
    },
    "custom": {
        "label": "Custom (base rules only)",
        "header": "Create a Minecraft Java Edition style pixel art sprite sheet.",
        "art_style": (
            "Strict pixel art, crisp square pixel clusters, hard edges, no anti-aliasing.\n"
            "Limited coherent palette, consistent lighting and pixel density.\n"
            "No photorealism, no 3D rendering, no smooth gradients."
        ),
        "material_language": "Use one coherent, limited palette across every cell.",
        "lighting": "Consistent top-left light source in every cell.",
        "cell_note": "one unique sprite per cell, centered",
    },
}

# --------------------------------------------------------------------------- #
# Fixed base constraint blocks (always appended)
# --------------------------------------------------------------------------- #

_FORMAT_TEMPLATE = """FORMAT:
- A perfectly aligned {cols} columns x {rows} rows grid ({n} cells).
- Exactly {n} individual sprites, one per cell.
- Every cell has IDENTICAL dimensions.
- Each sprite is centered inside its own cell.
- Equal spacing / gutter between all cells.
- No overlapping objects.
- No object extends outside its assigned cell.
- The grid fills the whole image edge to edge."""

_IMPORTANT_RULES = """IMPORTANT:
- Every cell contains EXACTLY ONE sprite. Do not merge, duplicate or omit any item.
- Maintain a consistent visual language, art style, scale and palette across ALL cells.
- Do NOT draw any text, letters, numbers, labels, captions or cell numbers anywhere.
- Do NOT add a watermark, logo, signature, border frame, drop shadow or decorations.
- Do NOT add a checkerboard, gradient or coloured background behind the sprites.
- The result must look like a professional Minecraft Java Edition mod resource pack asset sheet."""

_BACKGROUND_BLOCKS: dict[str, str] = {
    "white": (
        "BACKGROUND:\n"
        "- Solid PURE WHITE (#FFFFFF) flat background filling EVERY empty area of the image.\n"
        "- Uniform white also in the gutters between cells.\n"
        "- No shadows outside the sprites, no gradients, no tinted paper, no vignette."
    ),
    "transparent": (
        "BACKGROUND:\n"
        "- Fully transparent background (alpha 0) in every empty area.\n"
        "- No shadows outside the sprites, no opaque backdrop."
    ),
    "black": (
        "BACKGROUND:\n"
        "- Solid PURE BLACK (#000000) flat background filling EVERY empty area.\n"
        "- No shadows, no gradients, no vignette."
    ),
    "magenta": (
        "BACKGROUND:\n"
        "- Solid PURE MAGENTA (#FF00FF) flat chroma-key background filling EVERY empty area.\n"
        "- No shadows, no gradients, no vignette."
    ),
    "green": (
        "BACKGROUND:\n"
        "- Solid PURE GREEN (#00FF00) flat chroma-key background filling EVERY empty area.\n"
        "- No shadows, no gradients, no vignette."
    ),
}

# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #

DEFAULT_ITEMS: list[str] = [
    "Copper ingot",
    "Iron ingot",
    "Gold ingot",
    "Tin ingot",
    "Copper gear",
    "Iron gear",
    "Gold gear",
    "Steel gear",
    "Copper plate",
    "Iron plate",
    "Gold plate",
    "Steel plate",
    "Copper dust",
    "Iron dust",
    "Gold dust",
    "Steel dust",
]

GTCEU_STEEL_ITEMS: list[str] = [
    "Steel ingot",
    "Steel plate",
    "Steel gear",
    "Steel rod",
    "Steel ring",
    "Steel bolt",
    "Steel screw",
    "Steel rotor",
]


def slugify(name: str) -> str:
    """Turn an item label into a safe resource-pack file stem."""
    s = name.strip().lower()
    s = re.sub(r"[^a-z0-9]+", "_", s)
    return s.strip("_") or "sprite"


def _position_label(r: int, c: int, rows: int, cols: int) -> str:
    """Human-readable positional hint for a cell (1-indexed)."""
    vert = "top" if r == 1 else ("bottom" if r == rows else f"row {r}")
    horiz = "left" if c == 1 else ("right" if c == cols else f"column {c}")
    if r == 1 and c == 1:
        return "TOP-LEFT corner cell"
    if r == 1 and c == cols:
        return "TOP-RIGHT corner cell"
    if r == rows and c == 1:
        return "BOTTOM-LEFT corner cell"
    if r == rows and c == cols:
        return "BOTTOM-RIGHT corner cell"
    if r == 1:
        return f"top row, {horiz} from the left"
    if r == rows:
        return f"bottom row, {horiz} from the left"
    if c == 1:
        return f"{vert}, left edge cell"
    if c == cols:
        return f"{vert}, right edge cell"
    return f"{vert}, {horiz}"


def build_grid_map(rows: int, cols: int) -> str:
    """Compact ASCII map of cell indices, row-major, left-to-right."""
    width = max(3, len(str(rows * cols)) + 2)
    bar = "+" + "+".join(["-" * width] * cols) + "+"
    lines = [bar]
    for r in range(rows):
        cells = [str(r * cols + c + 1).center(width) for c in range(cols)]
        lines.append("|" + "|".join(cells) + "|")
        lines.append(bar)
    return "\n".join(lines)


def build_grid_assignment(items: list[str], rows: int, cols: int) -> str:
    """Explicit, precise per-cell position -> item statements."""
    lines: list[str] = []
    for idx, name in enumerate(items):
        r = idx // cols + 1
        c = idx % cols + 1
        label = _position_label(r, c, rows, cols)
        lines.append(f"- CELL r{r}c{c} (#{idx + 1}, {label}) -> \"{name}\"")
    return "\n".join(lines)


def build_reference_guidance(
    strength: float = 0.75, instructions: str = ""
) -> str:
    """Fixed REFERENCE IMAGE constraint block, adjustable by influence strength.

    A reference image is passed to the model as an img2img edit input.  The
    Image API has no numeric strength parameter, so the influence is expressed
    as an explicit prompt constraint instead -- and the grid rules are repeated
    so the reference cannot override the atlas layout.
    """
    s = max(0.05, min(1.0, float(strength)))
    if s >= 0.75:
        level, rule = (
            "HIGH",
            "Follow the reference closely for palette, material language and lighting.",
        )
    elif s >= 0.4:
        level, rule = (
            "MEDIUM",
            "Take moderate inspiration from the reference; keep the listed items recognisable.",
        )
    else:
        level, rule = (
            "LOW",
            "Use only a subtle hint of the reference; prioritise the described items.",
        )

    lines = [
        "REFERENCE IMAGE (attached to this request as an edit input):",
        f"- Reference influence: {level} ({s:.2f}).",
        f"- {rule}",
        "- Use the reference ONLY as a guide for art style, palette, material language, "
        "lighting and pixel density.",
        "- Do NOT copy the reference's composition, layout, text, labels or background "
        "into the output.",
        "- Keep the STRICT aligned grid and the EXACT CELL ASSIGNMENT described above.",
        "- Every cell still contains exactly ONE of the listed items on the specified "
        "solid background.",
    ]
    if instructions.strip():
        lines += [
            "- Additional reference guidance:",
            "  " + instructions.strip(),
        ]
    return "\n".join(lines)


def build_sheet_prompt(
    items: list[str],
    grid_rows: int = 4,
    grid_cols: int = 4,
    style: SheetStyle = "item",
    background: SheetBackground = "white",
    extra_instructions: str = "",
    custom_prompt: str | None = None,
    reference_guidance: str = "",
) -> str:
    """Assemble the final prompt sent to the model.

    ``custom_prompt`` (when non-empty) replaces the assembled body entirely,
    while the FIXED base rules are still appended so the output stays splittable.
    ``reference_guidance`` is appended to the body whenever a reference image is
    attached (also for custom prompts).
    """
    rows = max(1, min(8, int(grid_rows)))
    cols = max(1, min(8, int(grid_cols)))
    cleaned_items = [str(i).strip() for i in items if str(i).strip()]
    if not cleaned_items:
        cleaned_items = list(DEFAULT_ITEMS)
    # Truncate / pad to the exact number of cells so the assignment stays unambiguous
    n = rows * cols
    cleaned_items = (cleaned_items[:n] + [f"Item {k + 1}" for k in range(n)])[:n]

    preset = STYLE_PRESETS.get(style, STYLE_PRESETS["custom"])

    if custom_prompt and custom_prompt.strip():
        body = custom_prompt.strip()
    else:
        grid_map = build_grid_map(rows, cols)
        assignment = build_grid_assignment(cleaned_items, rows, cols)
        item_lines = "\n".join(
            f"{i + 1}. {name}" for i, name in enumerate(cleaned_items)
        )
        parts = [
            preset["header"],
            "",
            _FORMAT_TEMPLATE.format(cols=cols, rows=rows, n=n),
            "",
            "GRID MAP (row-major, cell numbers refer to the ITEMS list below):",
            grid_map,
            "",
            "EXACT CELL ASSIGNMENT (each item MUST appear in its own cell):",
            assignment,
            "",
            f"ITEMS ({n} total, row-major order):",
            item_lines,
            "",
            "ART STYLE:",
            preset["art_style"],
            "",
            preset["material_language"],
            "",
            "LIGHTING:",
            preset["lighting"],
            "",
            f"CELL CONTENT: {preset['cell_note']}.",
            "",
            _BACKGROUND_BLOCKS.get(background, _BACKGROUND_BLOCKS["white"]),
        ]
        if extra_instructions.strip():
            parts += ["", "ADDITIONAL INSTRUCTIONS:", extra_instructions.strip()]
        body = "\n".join(parts)

    if reference_guidance.strip():
        body = f"{body}\n\n{reference_guidance.strip()}"

    # FIXED base rules are always appended, even for a custom override.
    return f"{body}\n\n{_IMPORTANT_RULES}"
