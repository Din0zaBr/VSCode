FROM python:3.12-slim

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        libsystemd-dev \
        pkg-config \
        gcc \
    && pip install --no-cache-dir systemd-python \
    && apt-get purge -y gcc pkg-config \
    && apt-get autoremove -y \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY config.yml /etc/log-agent/config.yml
COPY src/ ./src/

RUN mkdir -p /var/lib/log-agent

ENV PYTHONUNBUFFERED=1

ENTRYPOINT ["python", "-m", "src.main"]
