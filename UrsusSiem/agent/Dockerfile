FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY src/ ./agent/src/
RUN touch ./agent/__init__.py

RUN mkdir -p /data /data/offsets /etc/logvault
COPY config.yaml /etc/logvault/config.yaml

ENV PYTHONUNBUFFERED=1
ENV PYTHONPATH=/app

ENTRYPOINT ["python", "-m", "agent.src.main"]
