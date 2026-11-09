"""OpenAI GPT Image 2 provider (OpenAI Images API / OpenAI-compatible relays)."""

from __future__ import annotations

import base64
import io

import httpx
from PIL import Image

from app.config import get_settings
from app.pixel_pipeline import image_to_png_bytes
from app.providers.base import BaseImageProvider
from app.schemas import ProviderId, TextureMode

_OPENAI_DEFAULT_BASE_URL = "https://api.openai.com/v1"


def _openai_urls(settings) -> tuple[str, str]:
    """Resolve the generations/edits endpoints from the (possibly custom) base URL."""
    base = (settings.openai_base_url or _OPENAI_DEFAULT_BASE_URL).rstrip("/")
    return f"{base}/images/generations", f"{base}/images/edits"


def _extract_openai_error(resp: httpx.Response) -> str:
    try:
        data = resp.json()
        if isinstance(data, dict) and "error" in data:
            err = data["error"]
            if isinstance(err, dict) and "message" in err:
                return f"HTTP {resp.status_code}: {err['message']}"
    except Exception:
        pass
    return f"HTTP {resp.status_code}: {resp.text[:400]}"


async def _decode_image_item(client: httpx.AsyncClient, item: dict) -> Image.Image:
    """GPT Image 2 may return base64 inline or a short-lived URL."""
    if item.get("b64_json"):
        raw = base64.b64decode(item["b64_json"])
        return Image.open(io.BytesIO(raw)).convert("RGBA")
    if item.get("url"):
        resp = await client.get(item["url"])
        resp.raise_for_status()
        return Image.open(io.BytesIO(resp.content)).convert("RGBA")
    raise RuntimeError(
        "GPT Image 2 response contained neither 'b64_json' nor 'url' image data."
    )


class OpenAIProvider(BaseImageProvider):
    """Generates textures via OpenAI GPT Image 2 (txt2img and img2img edits)."""

    provider_id: ProviderId = "openai"
    name = "OpenAI GPT Image 2"
    description = (
        "OpenAI GPT Image 2 via the Images API (OPENAI_API_KEY, optionally "
        "OPENAI_BASE_URL for an OpenAI-compatible relay)."
    )
    supports_img2img = True

    def is_configured(self) -> bool:
        return bool(get_settings().openai_api_key)

    async def generate(
        self,
        wrapped_prompt: str,
        mode: TextureMode,
        reference_image: Image.Image | None = None,
        strength: float = 0.75,
    ) -> Image.Image:
        settings = get_settings()
        if not settings.openai_api_key:
            raise RuntimeError("OPENAI_API_KEY is not configured in environment.")

        generations_url, edits_url = _openai_urls(settings)
        headers = {"Authorization": f"Bearer {settings.openai_api_key}"}
        size = settings.openai_image_size
        _ = (mode, strength)

        async with httpx.AsyncClient(timeout=180.0) as client:
            if reference_image is not None:
                png_bytes = image_to_png_bytes(
                    reference_image.convert("RGBA").resize((1024, 1024))
                )
                files = {"image": ("reference.png", png_bytes, "image/png")}
                data = {
                    "model": settings.openai_model,
                    "prompt": wrapped_prompt,
                    "size": size,
                    "n": 1,
                }
                response = await client.post(
                    edits_url, headers=headers, data=data, files=files
                )
            else:
                payload: dict[str, object] = {
                    "model": settings.openai_model,
                    "prompt": wrapped_prompt,
                    "size": size,
                    "n": 1,
                }
                response = await client.post(
                    generations_url, headers=headers, json=payload
                )

            if response.status_code != 200:
                raise RuntimeError(_extract_openai_error(response))

            body = response.json()
            data_items = body.get("data") or []
            if not data_items:
                raise RuntimeError("GPT Image 2 returned an empty data list.")
            return await _decode_image_item(client, data_items[0])
