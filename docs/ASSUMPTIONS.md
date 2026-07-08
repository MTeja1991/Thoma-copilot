# ASSUMPTIONS

| ID | Assumption | Status |
|----|------------|--------|
| A1 | User runs Docker on Linux or Windows with NVIDIA Container Toolkit for CUDA path | Open |
| A2 | RTX 4050 has 6 GB VRAM (laptop variant) | Confirmed |
| A3 | macOS Apple Silicon uses native Ollama for MPS/Metal (not Docker Ollama) | Confirmed |
| A4 | One model loaded at a time is acceptable on 6–8 GB memory | Confirmed |
| A5 | 16 GB unified memory Mac uses `models-mps-16gb.yaml` by default | Confirmed |
