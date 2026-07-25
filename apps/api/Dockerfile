FROM python:3.12-slim

WORKDIR /app

# INSTALL_LLAMACPP=1 for docker-compose.local.yml (GGUF via llama-cpp-python)
ARG INSTALL_LLAMACPP=0

RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && if [ "$INSTALL_LLAMACPP" = "1" ]; then \
         apt-get install -y --no-install-recommends cmake build-essential; \
       fi \
    && rm -rf /var/lib/apt/lists/* \
    && useradd -m -u 1000 thoma

COPY apps/api/requirements.txt apps/api/requirements-docker.txt ./
RUN if [ "$INSTALL_LLAMACPP" = "1" ]; then \
      pip install --no-cache-dir -r requirements.txt; \
    else \
      pip install --no-cache-dir -r requirements-docker.txt; \
    fi

COPY apps/__init__.py ./apps/
COPY apps/api/ ./apps/api/
COPY config/ ./config/

RUN chmod +x /app/apps/api/entrypoint.sh \
    && mkdir -p /app/data \
    && chown -R thoma:thoma /app

ENV THOMA_INFERENCE_BACKEND=ollama
ENV THOMA_MODELS_CONFIG=/app/config/models-6gb.yaml
ENV THOMA_DEFAULT_PROFILE=thoma-reason
ENV THOMA_PROJECT_ROOT=/app
ENV THOMA_DATA_DIR=data
ENV PYTHONPATH=/app
ENV THOMA_ENV=production
ENV THOMA_API_HOST=0.0.0.0
ENV THOMA_API_PORT=8080

USER thoma
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://127.0.0.1:8080/health/live || exit 1

ENTRYPOINT ["/app/apps/api/entrypoint.sh"]
