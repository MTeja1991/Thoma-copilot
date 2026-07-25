"""Inference backends package."""

from apps.api.backends.factory import create_inference_backend

__all__ = ["create_inference_backend"]
