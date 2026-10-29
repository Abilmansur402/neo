"""
Train the imaging classifiers used for Grad-CAM (chest X-ray: RDS / pneumothorax / ETT;
cranial ultrasound: IVH grade 0–IV). Requires PyTorch.

Usage
  python -m ml.train_imaging cxr --data data/cxr            # data/cxr/<class>/*.png  (class folders: rds, pneumothorax, ett)
  python -m ml.train_imaging cus --data data/cus            # class folders: ivh_0 … ivh_4
  python -m ml.train_imaging cxr                            # no data → procedurally generated demo set (CI / demo only)
  python -m ml.train_imaging cxr --data data/cxr --epochs 15 --push

The network is `services.cv_engine.TinyCNN` so the saved state_dict loads straight into the API.
For production fine-tune a DenseNet-121 in `build_model()` and keep the `(logits, feature_map)` contract.
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from services.cv_engine import CUS_CLASSES, CXR_CLASSES, TORCH_AVAILABLE  # noqa: E402

if not TORCH_AVAILABLE:
    raise SystemExit("PyTorch is required: pip install torch torchvision --index-url https://download.pytorch.org/whl/cpu")

import torch  # noqa: E402
import torch.nn.functional as F  # noqa: E402
from PIL import Image, ImageDraw, ImageFilter  # noqa: E402
from torch.utils.data import DataLoader, Dataset  # noqa: E402

from services.cv_engine import TinyCNN  # noqa: E402

SIZE = 256


# ---------------- datasets ----------------
class FolderDataset(Dataset):
    def __init__(self, root: Path, classes: list[str], augment: bool) -> None:
        self.items = [(p, i) for i, c in enumerate(classes) for p in sorted((root / c).glob("*")) if p.suffix.lower() in {".png", ".jpg", ".jpeg"}]
        self.augment = augment
        if not self.items:
            raise SystemExit(f"No images found under {root}/<class>/ — expected folders: {classes}")

    def __len__(self): return len(self.items)

    def __getitem__(self, i):
        p, y = self.items[i]
        img = Image.open(p).convert("L").resize((SIZE, SIZE))
        if self.augment:
            if np.random.rand() < 0.5: img = img.transpose(Image.FLIP_LEFT_RIGHT)
            img = img.rotate(np.random.uniform(-8, 8), fillcolor=0)
        x = torch.from_numpy(np.asarray(img, dtype=np.float32) / 255.0)[None]
        return x, y


def synth_image(kind: str, cls: int, rng: np.random.Generator) -> Image.Image:
    """Procedural stand-in images with class-dependent structure, for demo training only."""
    img = Image.new("L", (SIZE, SIZE), 8); d = ImageDraw.Draw(img)
    if kind == "cxr":
        d.ellipse([30, 40, 226, 246], fill=60)
        lung = 110 if cls == 0 else 40
        d.ellipse([55, 60, 125, 210], fill=lung); d.ellipse([131, 60, 201, 210], fill=lung if cls != 1 else 40)
        if cls == 1: d.pieslice([131, 50, 201, 120], 180, 360, fill=5)
        for y in range(70, 200, 20): d.line([(128, y), (40, y + 30)], fill=180, width=4); d.line([(128, y), (216, y + 30)], fill=180, width=4)
        d.rectangle([124, 0, 132, 95 if cls == 2 else 70], fill=230)
    else:
        d.pieslice([-60, -200, 316, 300], 60, 120, fill=55)
        d.ellipse([88, 110, 118, 170], fill=15); d.ellipse([138, 110, 168, 170], fill=15)
        if cls >= 1: d.ellipse([92, 112, 92 + 8 * cls, 112 + 10 * cls], fill=235)
        if cls >= 3: d.ellipse([80, 100, 125, 185], fill=10)
        if cls == 4: d.ellipse([40, 120, 85, 170], fill=220)
    arr = np.asarray(img).astype(np.float32) + rng.normal(0, 18, (SIZE, SIZE))
    return Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1))


class SynthDataset(Dataset):
    def __init__(self, kind: str, n_classes: int, n: int, seed: int) -> None:
        rng = np.random.default_rng(seed)
        self.items = [(synth_image(kind, c, rng), c) for c in range(n_classes) for _ in range(n // n_classes)]

    def __len__(self): return len(self.items)

    def __getitem__(self, i):
        img, y = self.items[i]
        return torch.from_numpy(np.asarray(img, dtype=np.float32) / 255.0)[None], y


# ---------------- training ----------------
def build_model(n_classes: int) -> torch.nn.Module:
    return TinyCNN(n_classes)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("kind", choices=["cxr", "cus"]); ap.add_argument("--data"); ap.add_argument("--out", default=str(Path(__file__).resolve().parents[1] / "artifacts"))
    ap.add_argument("--epochs", type=int, default=8); ap.add_argument("--batch", type=int, default=16); ap.add_argument("--lr", type=float, default=1e-3)
    ap.add_argument("--version", default="v1"); ap.add_argument("--seed", type=int, default=7); ap.add_argument("--push", action="store_true")
    args = ap.parse_args()
    torch.manual_seed(args.seed)
    classes = [c[0] for c in (CXR_CLASSES if args.kind == "cxr" else CUS_CLASSES)]

    if args.data:
        full = FolderDataset(Path(args.data), classes, augment=True); source = args.data
    else:
        full = SynthDataset(args.kind, len(classes), 240, args.seed); source = "synthetic-procedural"
    n_val = max(len(full) // 5, len(classes))
    train_ds, val_ds = torch.utils.data.random_split(full, [len(full) - n_val, n_val], generator=torch.Generator().manual_seed(args.seed))
    tl, vl = DataLoader(train_ds, batch_size=args.batch, shuffle=True), DataLoader(val_ds, batch_size=args.batch)

    model = build_model(len(classes)); opt = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=1e-4)
    best, best_state = 0.0, None
    for ep in range(args.epochs):
        model.train(); loss_sum = 0.0
        for x, y in tl:
            opt.zero_grad(); logits, _ = model(x); loss = F.cross_entropy(logits, y); loss.backward(); opt.step(); loss_sum += loss.item() * len(y)
        model.eval(); correct = 0
        with torch.no_grad():
            for x, y in vl: correct += (model(x)[0].argmax(1) == y).sum().item()
        acc = correct / len(val_ds)
        print(f"  epoch {ep + 1}/{args.epochs} · loss {loss_sum / len(train_ds):.3f} · val acc {acc:.3f}")
        if acc >= best: best, best_state = acc, {k: v.clone() for k, v in model.state_dict().items()}

    out = Path(args.out); out.mkdir(parents=True, exist_ok=True)
    name = f"{args.kind}-{args.version}"
    torch.save(best_state, out / f"{name}.pt")
    meta = {"version": name, "classes": classes, "val_accuracy": round(best, 4), "n_train": len(train_ds), "n_val": len(val_ds), "data_source": source,
            "trained_at": datetime.now(timezone.utc).isoformat(), "input": f"{SIZE}x{SIZE} grayscale"}
    (out / f"{name}.meta.json").write_text(json.dumps(meta, indent=2))
    print(f"[train] {name} · val acc {best:.3f} · saved → {out}")
    if args.push:
        from ml.registry import push
        print("[train] pushed", push(name, args.version, out))


if __name__ == "__main__":
    main()
