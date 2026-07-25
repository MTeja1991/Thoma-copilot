FROM python:3.12-slim

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/* \
    && useradd -m -u 1000 thoma

COPY apps/api/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY apps/api/ ./apps/api/
COPY config/ ./config/

RUN chmod +x /app/apps/api/entrypoint.sh \
    && mkdir -p /app/data \
    && chown -R thoma:thoma /app

ENV THOMA_MODELS_CONFIG=/app/config/models-6gb.yaml
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
