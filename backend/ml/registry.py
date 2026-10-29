"""
S3 model registry (works with AWS S3 and S3-compatible stores: MinIO, Yandex, VK Cloud, PS Cloud, etc.).

Layout in the bucket:
  models/<name>/<version>/<files…>        e.g. models/xgb-24h/v3.1/xgb-24h.json
  models/<name>/latest.json               {"version": "v3.1", "files": [...], "pushed_at": "..."}

Configure with env vars (see deploy/.env.production.example):
  NEO_S3_ENDPOINT, NEO_S3_BUCKET, NEO_S3_ACCESS_KEY, NEO_S3_SECRET_KEY, NEO_S3_REGION, NEO_S3_PATH_STYLE
"""
from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path

ARTIFACT_FILES = {
    "xgb-24h": ["xgb-24h.json", "xgb-24h.meta.json", "xgb-24h.calib.joblib"],
    "cxr-v1": ["cxr-v1.pt", "cxr-v1.meta.json"],
    "cus-v1": ["cus-v1.pt", "cus-v1.meta.json"],
}


def configured() -> bool:
    return bool(os.getenv("NEO_S3_BUCKET") and os.getenv("NEO_S3_ACCESS_KEY") and os.getenv("NEO_S3_SECRET_KEY"))


def _client():
    import boto3
    from botocore.config import Config

    addressing = "path" if os.getenv("NEO_S3_PATH_STYLE", "true").lower() in {"1", "true", "yes"} else "virtual"
    return boto3.client(
        "s3",
        endpoint_url=os.getenv("NEO_S3_ENDPOINT") or None,
        region_name=os.getenv("NEO_S3_REGION") or "us-east-1",
        aws_access_key_id=os.getenv("NEO_S3_ACCESS_KEY"),
        aws_secret_access_key=os.getenv("NEO_S3_SECRET_KEY"),
        config=Config(s3={"addressing_style": addressing}, signature_version="s3v4"),
    )


def push(name: str, version: str, artifact_dir: str | Path) -> dict:
    """Upload an artifact set and mark it as latest."""
    if not configured():
        raise RuntimeError("S3 registry not configured (NEO_S3_* env vars)")
    bucket = os.environ["NEO_S3_BUCKET"]
    s3 = _client()
    artifact_dir = Path(artifact_dir)
    files = [f for f in ARTIFACT_FILES[name] if (artifact_dir / f).exists()]
    for f in files:
        s3.upload_file(str(artifact_dir / f), bucket, f"models/{name}/{version}/{f}")
    manifest = {"name": name, "version": version, "files": files, "pushed_at": datetime.now(timezone.utc).isoformat()}
    s3.put_object(Bucket=bucket, Key=f"models/{name}/latest.json", Body=json.dumps(manifest).encode(), ContentType="application/json")
    return manifest


def pull(name: str, artifact_dir: str | Path, version: str | None = None) -> dict | None:
    """Download the latest (or a pinned) artifact set. Returns the manifest or None if nothing is published."""
    if not configured():
        return None
    bucket = os.environ["NEO_S3_BUCKET"]
    s3 = _client()
    artifact_dir = Path(artifact_dir)
    artifact_dir.mkdir(parents=True, exist_ok=True)
    try:
        if version is None:
            manifest = json.loads(s3.get_object(Bucket=bucket, Key=f"models/{name}/latest.json")["Body"].read())
            version = manifest["version"]
        else:
            manifest = {"name": name, "version": version, "files": ARTIFACT_FILES[name]}
    except Exception as exc:  # NoSuchKey or connectivity
        print(f"[registry] no published {name}: {exc.__class__.__name__}")
        return None
    for f in manifest["files"]:
        try:
            s3.download_file(bucket, f"models/{name}/{version}/{f}", str(artifact_dir / f))
        except Exception as exc:
            print(f"[registry] skip {f}: {exc.__class__.__name__}")
    print(f"[registry] pulled {name} {version} → {artifact_dir}")
    return manifest


if __name__ == "__main__":  # python -m ml.registry push xgb-24h v3.2 ./artifacts
    import sys

    cmd, name, *rest = sys.argv[1:]
    if cmd == "push":
        print(push(name, rest[0], rest[1] if len(rest) > 1 else "./artifacts"))
    elif cmd == "pull":
        print(pull(name, rest[0] if rest else "./artifacts"))
