FROM python:3.12-slim

RUN apt-get update && \
    apt-get install -y --no-install-recommends systemd && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY src/ ./agent/src/

RUN mkdir -p /data /etc/logvault
COPY config.yaml /etc/logvault/config.yaml

ENV PYTHONUNBUFFERED=1
ENV PYTHONPATH=/app

CMD ["python", "-m", "agent.src.main"]
