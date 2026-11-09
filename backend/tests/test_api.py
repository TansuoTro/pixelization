"""API integration tests for FastAPI routes and multi-provider switching."""

from __future__ import annotations

import io

import numpy as np
from fastapi.testclient import TestClient
from PIL import Image

from app.main import app
from app.pixel_pipeline import base64_to_image

client = TestClient(app)


def test_health_and_security_headers() -> None:
    resp = client.get("/api/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}
    assert resp.headers["X-Content-Type-Options"] == "nosniff"
    assert resp.headers["X-Frame-Options"] == "DENY"
    assert "Content-Security-Policy" in resp.headers


def test_list_providers_returns_all_supported_backends() -> None:
    resp = client.get("/api/providers")
    assert resp.status_code == 200
    body = resp.json()
    ids = {p["id"] for p in body["providers"]}
    assert body["default_provider"] in ids
    assert ids == {
        "upload_only",
        "pollinations",
        "mock",
        "huggingface",
        "openai",
        "gemini",
        "replicate",
        "fal",
        "local_sd",
    }


def test_generate_item_and_block_textures() -> None:
    # Item generation (16x16)
    resp_item = client.post(
        "/api/generate",
        data={
            "prompt": "enchanted ruby sword",
            "mode": "item",
            "size": "16",
            "provider": "mock",
            "palette_colors": "16",
        },
    )
    assert resp_item.status_code == 200
    data_item = resp_item.json()
    assert data_item["mode"] == "item"
    assert data_item["size"] == 16
    assert "16-bit pixel art sprite" in data_item["wrapped_prompt"]
    item_img = base64_to_image(data_item["processed_image_b64"])
    assert item_img.size == (16, 16)
    alpha_vals = set(np.unique(np.asarray(item_img)[:, :, 3]).tolist())
    assert alpha_vals.issubset({0, 255})

    # Block generation (32x32) with reference image upload
    ref_img = Image.new("RGBA", (64, 64), (80, 160, 90, 255))
    buf = io.BytesIO()
    ref_img.save(buf, format="PNG")
    buf.seek(0)

    resp_block = client.post(
        "/api/generate",
        data={
            "prompt": "mossy cobblestone",
            "mode": "block",
            "size": "32",
            "provider": "mock",
            "strength": "0.65",
        },
        files={"reference_image": ("ref.png", buf.getvalue(), "image/png")},
    )
    assert resp_block.status_code == 200
    data_block = resp_block.json()
    assert data_block["mode"] == "block"
    assert data_block["size"] == 32
    assert "seamless tileable texture" in data_block["wrapped_prompt"]
    block_img = base64_to_image(data_block["processed_image_b64"])
    assert block_img.size == (32, 32)
    assert np.all(np.asarray(block_img)[:, :, 3] == 255)


def test_reprocess_endpoint_resizes_without_new_inference() -> None:
    gen = client.post(
        "/api/generate",
        data={"prompt": "diamond pickaxe", "mode": "item", "size": "16", "provider": "mock"},
    ).json()

    reproc = client.post(
        "/api/reprocess",
        json={
            "raw_image_b64": gen["raw_image_b64"],
            "mode": "item",
            "size": 64,
            "palette_colors": 24,
            "alpha_threshold": 128,
            "strip_background": True,
        },
    )
    assert reproc.status_code == 200
    reproc_img = base64_to_image(reproc.json()["processed_image_b64"])
    assert reproc_img.size == (64, 64)

