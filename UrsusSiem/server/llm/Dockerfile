# URSUS LLM service.
# Model file is mounted at /models/*.gguf (NOT baked into the image —
# 7B models are ~5 GB, mount instead of bloating registry).

FROM python:3.12-slim

WORKDIR /app

# Build tooling for llama-cpp-python wheels (CPU path).
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential ca-certificates curl \
 && rm -rf /var/lib/apt/lists/*

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY app.py ./

ENV URSUS_LLM_MODEL=/models/vikhr-7b-instruct.gguf \
    URSUS_LLM_N_CTX=4096 \
    URSUS_LLM_GPU_LAYERS=0

EXPOSE 8000
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000"]
