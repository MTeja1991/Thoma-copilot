"""Load and resolve Thoma model profiles from YAML config."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Optional

import yaml


@dataclass(frozen=True)
class ModelProfile:
    id: str
    description: str
    thinking: bool
    context_length: int
    memory_estimate_gb: str
    ollama_model: str = ""
    model_file: str = ""
    stretch: bool = False

    @property
    def display_model(self) -> str:
        return self.model_file or self.ollama_model


@dataclass(frozen=True)
class HardwareInfo:
    backend: str
    platform: str
    memory_gb: Optional[int]
    accelerator: str


def models_dir() -> Path:
    root = Path(os.environ.get("THOMA_PROJECT_ROOT", Path.cwd()))
    rel = os.environ.get("THOMA_MODELS_DIR", "models/gguf")
    return (root / rel).resolve()


def _config_path() -> Path:
    return Path(os.environ.get("THOMA_MODELS_CONFIG", "config/models-local-mps-16gb.yaml"))


def _read_config() -> dict[str, Any]:
    path = _config_path()
    if not path.exists():
        raise FileNotFoundError(f"Model config not found: {path}")
    return yaml.safe_load(path.read_text()) or {}


def get_hardware_info() -> HardwareInfo:
    raw = _read_config()
    hw = raw.get("hardware") or {}
    memory = hw.get("vram_gb") or hw.get("unified_memory_gb")
    return HardwareInfo(
        backend=str(hw.get("backend", os.environ.get("THOMA_BACKEND", "unknown"))),
        platform=str(hw.get("platform", hw.get("gpu", "generic"))),
        memory_gb=int(memory) if memory is not None else None,
        accelerator=str(hw.get("accelerator", hw.get("backend", "unknown"))),
    )


def _parse_profile(pid: str, spec: dict[str, Any], stretch: bool) -> ModelProfile:
    ollama = str(spec.get("ollama_model", "") or "")
    model_file = str(spec.get("model_file", "") or "")
    if not ollama and not model_file:
        raise ValueError(f"Profile {pid} needs model_file or ollama_model")

    mem = str(spec.get("memory_estimate_gb") or spec.get("vram_estimate_gb", "?"))
    return ModelProfile(
        id=pid,
        description=spec.get("description", ""),
        ollama_model=ollama,
        model_file=model_file,
        thinking=bool(spec.get("thinking", False)),
        context_length=int(spec.get("context_length", 4096)),
        memory_estimate_gb=mem,
        stretch=stretch,
    )


def load_profiles() -> dict[str, ModelProfile]:
    raw = _read_config()
    profiles: dict[str, ModelProfile] = {}

    for pid, spec in (raw.get("profiles") or {}).items():
        profiles[pid] = _parse_profile(pid, spec, stretch=False)

    for pid, spec in (raw.get("stretch_profiles") or {}).items():
        profiles[pid] = _parse_profile(pid, spec, stretch=True)

    return profiles


def get_default_profile_id() -> str:
    raw = _read_config()
    return str(raw.get("default_profile", "thoma-reason"))


def list_required_gguf_files() -> list[str]:
    profiles = load_profiles()
    files: list[str] = []
    for p in profiles.values():
        if p.model_file and p.model_file not in files:
            files.append(p.model_file)
    return files


def resolve_model_path(profile: ModelProfile) -> Path:
    if profile.model_file:
        return models_dir() / profile.model_file
    raise ValueError(f"Profile {profile.id} has no model_file for local inference")


def resolve_profile(model_or_profile: str, profiles: dict[str, ModelProfile]) -> ModelProfile:
    if model_or_profile in profiles:
        return profiles[model_or_profile]
    for p in profiles.values():
        if p.ollama_model == model_or_profile or p.model_file == model_or_profile:
            return p
    raise KeyError(f"Unknown model or profile: {model_or_profile}")
