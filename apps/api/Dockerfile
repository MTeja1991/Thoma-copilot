FROM python:3.12-slim

WORKDIR /app

COPY apps/api/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY apps/api/ ./apps/api/
COPY config/ ./config/

ENV THOMA_MODELS_CONFIG=/app/config/models-6gb.yaml
ENV PYTHONPATH=/app

EXPOSE 8080

CMD ["uvicorn", "apps.api.main:app", "--host", "0.0.0.0", "--port", "8080"]
