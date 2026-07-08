#!/usr/bin/env python3
"""Download GGUF model files from Hugging Face into models/gguf/."""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "config" / "gguf-manifest.yaml"
DEFAULT_OUT = ROOT / "models" / "gguf"


def load_manifest() -> dict:
    return yaml.safe_load(MANIFEST.read_text()) or {}


def files_from_config(config_path: Path) -> list[str]:
    raw = yaml.safe_load(config_path.read_text()) or {}
    return list(raw.get("download_files") or [])


def main() -> int:
    parser = argparse.ArgumentParser(description="Download thoma GGUF models locally")
    parser.add_argument(
        "--config",
        default=os.environ.get("THOMA_MODELS_CONFIG", "config/models-local-mps-16gb.yaml"),
        help="Profile config with download_files list",
    )
    parser.add_argument("--out", default=str(DEFAULT_OUT), help="Output directory")
    parser.add_argument("--all-manifest", action="store_true", help="Download entire manifest")
    args = parser.parse_args()

    try:
        from huggingface_hub import hf_hub_download
        from huggingface_hub.utils import GatedRepoError, HfHubHTTPError
    except ImportError:
        print("Install: pip install huggingface_hub", file=sys.stderr)
        return 1

    token = os.environ.get("HF_TOKEN") or os.environ.get("HUGGING_FACE_HUB_TOKEN")
    if not token:
        print("Tip: set HF_TOKEN or run `huggingface-cli login` for gated official repos.\n")

    manifest = load_manifest().get("assets") or {}
    config_path = ROOT / args.config
    if not config_path.is_file():
        print(f"Config not found: {config_path}", file=sys.stderr)
        return 1

    names = list(manifest.keys()) if args.all_manifest else files_from_config(config_path)
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    print(f"thoma GGUF download → {out_dir}")
    print(f"Config: {config_path.name} ({len(names)} files)\n")

    failed: list[str] = []
    for name in names:
        spec = manifest.get(name)
        if not spec:
            print(f"SKIP {name}: not in gguf-manifest.yaml")
            continue

        dest = out_dir / name
        if dest.is_file():
            print(f"OK   {name} (already exists)")
            continue

        repo_id = spec["repo_id"]
        filename = spec["filename"]
        print(f"GET  {name} from {repo_id} ...")

        try:
            path = hf_hub_download(
                repo_id=repo_id,
                filename=filename,
                local_dir=str(out_dir),
                token=token,
            )
            downloaded = Path(path)
            if downloaded.is_file() and downloaded.name != name:
                downloaded.rename(dest)
            elif not dest.is_file() and downloaded.is_file():
                dest = downloaded
            print(f"     → {dest}")
        except GatedRepoError:
            failed.append(name)
            print(
                f"FAIL {name}: gated repo — accept license at "
                f"https://huggingface.co/{repo_id} then run `huggingface-cli login`"
            )
        except HfHubHTTPError as exc:
            failed.append(name)
            print(f"FAIL {name}: {exc}")
        except Exception as exc:
            failed.append(name)
            print(f"FAIL {name}: {exc}")

    print()
    if failed:
        print(f"Finished with {len(failed)} failure(s): {', '.join(failed)}")
        print("Other models may still be usable. Re-run to retry failed downloads.")
        return 1

    print("Done. Start API with:")
    print("  ./docker/scripts/start-smoke.sh")
    print("  # or models-local-mps-16gb.yaml if you downloaded the full set")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
