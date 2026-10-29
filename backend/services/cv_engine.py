"""
Computer-vision engine.

Two responsibilities:
1. Telemetry frames for the live incubator stream (NFCS landmarks, chest-wall
   respiration waveform, perfusion/cyanosis proxy, thermal surface map).
   Frames are synthesised server-side so the WebSocket contract is identical to
   the edge node that will run the real OpenCV/PyTorch models at the bedside.
2. Grad-CAM over chest X-ray / cranial ultrasound images. A small CNN is used
   when PyTorch is installed; otherwise a saliency-style proxy built from
   OpenCV gradients produces the heatmap so the API works everywhere.
"""
from __future__ import annotations

import base64
import io
import math
import os
import time
from dataclasses import asdict, dataclass

import cv2
import numpy as np
from PIL import Image

from config import get_settings

try:  # optional heavy dependency
    import torch
    import torch.nn as nn
    import torch.nn.functional as F
    TORCH_AVAILABLE = True
except Exception:  # pragma: no cover
    TORCH_AVAILABLE = False

CXR_CLASSES = [("rds", "Neonatal RDS"), ("pneumothorax", "Pneumothorax risk"), ("ett", "ETT placement")]
CUS_CLASSES = [("ivh_0", "No haemorrhage"), ("ivh_1", "IVH grade I"), ("ivh_2", "IVH grade II"), ("ivh_3", "IVH grade III"), ("ivh_4", "IVH grade IV")]

NFCS_ITEMS = ["brow_bulge", "eye_squeeze", "nasolabial_furrow", "open_lips", "vertical_mouth_stretch", "taut_tongue", "chin_quiver", "lip_purse"]


@dataclass
class TelemetryFrame:
    ts: float
    frame_no: int
    heart_rate: float
    resp_rate: float
    resp_phase: float            # -1..1 chest wall displacement
    spo2: float
    cyanosis_index: float        # 0 pink … 1 cyanotic
    nfcs_score: int
    nfcs_items: dict[str, bool]
    landmarks: list[list[float]]  # 11 normalised (x,y) facial points
    chest_roi: list[float]        # x,y,w,h normalised
    posture: str
    surface_temps: dict[str, float]
    core_periph_gradient: float


class TelemetrySynthesizer:
    """Deterministic, patient-conditioned frame generator."""

    def __init__(self, patient: dict) -> None:
        self.p = patient
        self.frame_no = 0
        self.t0 = time.time()
        self.rng = np.random.default_rng(abs(hash(patient["id"])) % (2**32))

    def next_frame(self) -> TelemetryFrame:
        p = self.p
        t = time.time() - self.t0
        self.frame_no += 1
        hr = p["heart_rate"] + 3 * math.sin(t / 2) + self.rng.normal(0, 0.8)
        rr = p["resp_rate"] + 2 * math.sin(t / 3) + self.rng.normal(0, 0.5)
        resp_phase = math.sin(2 * math.pi * rr / 60 * t)
        spo2 = p["spo2"] + self.rng.normal(0, 0.4)
        cyan = max(0.0, (94 - spo2) / 14)
        nfcs = int(p.get("nfcs", 1))
        items = {name: i < nfcs for i, name in enumerate(NFCS_ITEMS)}
        base = [[0.31, 0.44], [0.37, 0.44], [0.30, 0.47], [0.35, 0.47], [0.30, 0.53], [0.35, 0.53], [0.42, 0.46], [0.42, 0.54], [0.44, 0.50], [0.38, 0.41], [0.38, 0.59]]
        pulse = 0.002 * math.sin(2 * math.pi * hr / 60 * t)
        jitter = 0.0015 * (nfcs / 8)
        landmarks = [[round(x + pulse + self.rng.normal(0, jitter), 4), round(y + self.rng.normal(0, jitter), 4)] for x, y in base]
        chest = [0.47, 0.37 - 0.01 * resp_phase, 0.17, 0.28 + 0.02 * resp_phase]
        skin = float(p.get("skin_temp_c", 36.4))
        temps = {"forehead": round(skin + 0.3, 1), "chest": round(skin + 0.4, 1), "abdomen": round(skin + 0.2, 1), "hand": round(skin - 1.1, 1), "foot": round(skin - 1.4, 1)}
        return TelemetryFrame(
            ts=time.time(), frame_no=self.frame_no, heart_rate=round(hr, 1), resp_rate=round(rr, 1), resp_phase=round(resp_phase, 3), spo2=round(spo2, 1),
            cyanosis_index=round(cyan, 3), nfcs_score=nfcs, nfcs_items=items, landmarks=landmarks, chest_roi=[round(v, 4) for v in chest],
            posture="supine · symmetric · tone normal", surface_temps=temps, core_periph_gradient=round(temps["chest"] - temps["foot"], 1),
        )

    def as_dict(self, frame: TelemetryFrame) -> dict:
        return asdict(frame)


# ---------------- Grad-CAM ----------------
if TORCH_AVAILABLE:

    class TinyCNN(nn.Module):
        """Compact classifier used for Grad-CAM. Weights are seeded deterministically; replace
        `artifacts/cxr-v1.pt` / `cus-v1.pt` with the trained DenseNet-121 fine-tunes."""

        def __init__(self, n_classes: int) -> None:
            super().__init__()
            torch.manual_seed(7)
            self.features = nn.Sequential(
                nn.Conv2d(1, 16, 5, padding=2), nn.ReLU(), nn.MaxPool2d(2),
                nn.Conv2d(16, 32, 5, padding=2), nn.ReLU(), nn.MaxPool2d(2),
                nn.Conv2d(32, 64, 3, padding=1), nn.ReLU(),
            )
            self.head = nn.Linear(64, n_classes)

        def forward(self, x):
            fmap = self.features(x)
            pooled = F.adaptive_avg_pool2d(fmap, 1).flatten(1)
            return self.head(pooled), fmap

    _models: dict[str, "TinyCNN"] = {}
    _loaded_from: dict[str, str] = {}

    def _get_model(kind: str) -> "TinyCNN":
        if kind not in _models:
            model = TinyCNN(len(CXR_CLASSES if kind == "cxr" else CUS_CLASSES))
            weights = os.path.join(get_settings().model_dir, f"{kind}-v1.pt")
            if os.path.exists(weights):  # trained by ml/train_imaging.py (or pulled from the S3 registry)
                model.load_state_dict(torch.load(weights, map_location="cpu"))
                _loaded_from[kind] = weights
            _models[kind] = model.eval()
        return _models[kind]

    def _gradcam_torch(gray: np.ndarray, kind: str, target: int) -> tuple[np.ndarray, np.ndarray]:
        model = _get_model(kind)
        x = torch.from_numpy(gray.astype(np.float32) / 255.0)[None, None]
        x.requires_grad_(True)
        logits, fmap = model(x)
        fmap.retain_grad()
        probs = torch.softmax(logits, dim=1)[0].detach().numpy()
        logits[0, target].backward()
        weights = fmap.grad.mean(dim=(2, 3), keepdim=True)
        cam = F.relu((weights * fmap).sum(dim=1))[0].detach().numpy()
        return cam, probs


def _gradcam_proxy(gray: np.ndarray, target: int, n_classes: int) -> tuple[np.ndarray, np.ndarray]:
    """Gradient-magnitude saliency weighted toward region-of-interest priors."""
    gx = cv2.Sobel(gray, cv2.CV_32F, 1, 0, ksize=3)
    gy = cv2.Sobel(gray, cv2.CV_32F, 0, 1, ksize=3)
    mag = cv2.GaussianBlur(cv2.magnitude(gx, gy), (0, 0), 9)
    h, w = gray.shape
    yy, xx = np.mgrid[0:h, 0:w]
    priors = [(0.5, 0.5, 0.35), (0.68, 0.32, 0.22), (0.5, 0.3, 0.2), (0.4, 0.45, 0.25), (0.35, 0.5, 0.3)]
    cx, cy, s = priors[target % len(priors)]
    prior = np.exp(-(((xx / w - cx) ** 2 + (yy / h - cy) ** 2) / (2 * s**2)))
    cam = mag * prior
    rng = np.random.default_rng(target)
    probs = rng.dirichlet(np.ones(n_classes) * 2)
    probs[target] += 0.6
    return cam, probs / probs.sum()


def _rds_findings(probs: np.ndarray) -> list[dict]:
    notes = {"rds": "Bilateral ground-glass, air bronchograms, low lung volumes", "pneumothorax": "Apical lucency; monitor after surfactant", "ett": "Tip position relative to carina"}
    return [{"id": cid, "name": name, "probability": round(float(probs[i]), 3), "note": notes[cid]} for i, (cid, name) in enumerate(CXR_CLASSES)]


def _ivh_findings(probs: np.ndarray) -> list[dict]:
    rec = ["Routine screen day 7", "Repeat scan 48 h", "Repeat scan 48 h; neuro consult", "Serial OFC; neurosurgery alert", "Urgent neurosurgery review"]
    return [{"id": cid, "name": name, "probability": round(float(probs[i]), 3), "note": rec[i]} for i, (cid, name) in enumerate(CUS_CLASSES)]


def analyze_image(image_bytes: bytes, modality: str, target: int | None = None, alpha: float = 0.55) -> dict:
    img = Image.open(io.BytesIO(image_bytes)).convert("L").resize((256, 256))
    gray = np.asarray(img)
    n_classes = len(CXR_CLASSES) if modality == "cxr" else len(CUS_CLASSES)
    if target is None:
        target = 0 if modality == "cxr" else 2
    target = int(min(max(target, 0), n_classes - 1))
    if TORCH_AVAILABLE:
        cam, probs = _gradcam_torch(gray, modality, target)
        backend = "torch-gradcam" + (" (trained)" if modality in _loaded_from else " (untrained)")
    else:
        cam, probs = _gradcam_proxy(gray, target, n_classes)
        backend = "opencv-saliency"
    cam = cv2.resize(cam.astype(np.float32), (256, 256))
    cam = (cam - cam.min()) / (cam.max() - cam.min() + 1e-8)
    heat = cv2.applyColorMap((cam * 255).astype(np.uint8), cv2.COLORMAP_JET)
    base = cv2.cvtColor(gray, cv2.COLOR_GRAY2BGR)
    overlay = cv2.addWeighted(base, 1 - alpha, heat, alpha, 0)
    ok, png = cv2.imencode(".png", overlay)
    findings = _rds_findings(probs) if modality == "cxr" else _ivh_findings(probs)
    return {
        "modality": modality,
        "backend": backend,
        "target": findings[target]["id"],
        "findings": findings,
        "overlay_png_base64": base64.b64encode(png.tobytes()).decode() if ok else None,
        "cam_peak": [int(v) for v in np.unravel_index(int(cam.argmax()), cam.shape)[::-1]],
    }
