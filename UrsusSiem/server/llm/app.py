"""URSUS SIEM — local LLM micro-service.

Provides:
  POST /nl-to-pdql   — translate Russian/English question to PDQL
  POST /explain      — rewrite a SIGMA-generated alert into human language
  POST /narrative    — turn a list of events into a connected incident story
  POST /parse-format — given sample log lines, return a grok/regex pattern

Designed to run on the same host as logvault-go (Pro edition). Uses
llama.cpp via the llama-cpp-python binding so CPU-only inference works
without external SaaS dependencies (152-ФЗ friendly).

Default model: Vikhr-7B-instruct (russified Mistral). Override with
`URSUS_LLM_MODEL` env var. On startup the service tries to memory-map the
GGUF file; if it isn't present, every endpoint returns a 503 with a
clear "model not loaded" message so callers can degrade gracefully.
"""
from __future__ import annotations

import json
import logging
import os
from typing import Any, Optional

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

log = logging.getLogger("logvault-llm")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s — %(message)s")

# Lazy import — keeps the service runnable without the model for testing.
_llama: Optional[Any] = None


def get_model() -> Any:
    global _llama
    if _llama is not None:
        return _llama
    model_path = os.environ.get("URSUS_LLM_MODEL", "/models/vikhr-7b-instruct.gguf")
    if not os.path.exists(model_path):
        raise RuntimeError(f"model file not found at {model_path}")
    try:
        from llama_cpp import Llama  # type: ignore
    except ImportError as e:
        raise RuntimeError("llama-cpp-python is not installed") from e
    log.info("loading model from %s", model_path)
    _llama = Llama(
        model_path=model_path,
        n_ctx=int(os.environ.get("URSUS_LLM_N_CTX", "4096")),
        n_threads=int(os.environ.get("URSUS_LLM_THREADS", "0")) or None,
        n_gpu_layers=int(os.environ.get("URSUS_LLM_GPU_LAYERS", "0")),
        verbose=False,
    )
    log.info("model loaded")
    return _llama


def infer(prompt: str, max_tokens: int = 256, stop: list[str] | None = None) -> str:
    model = get_model()
    out = model(prompt, max_tokens=max_tokens, stop=stop or [], echo=False)
    return out["choices"][0]["text"].strip()


# ────────────────────────────────────────────────────────────────────────────
# Prompts
# ────────────────────────────────────────────────────────────────────────────

NL_TO_PDQL_PROMPT = """\
Ты транслируешь вопросы на естественном языке в запрос PDQL — DSL URSUS SIEM.

Синтаксис PDQL:
  filter(<выражение>) | select(field, ...) | sort(field [desc]) | limit(N)
  Операторы: = != > < >= <= IN MATCH CONTAINS STARTSWITH ENDSWITH
  Поля: timestamp, host, user, level, src.ip, dst.ip, service, message, ...
  Время: now()-1d, now()-1h, '2026-05-24T00:00:00Z'

Примеры:
  Q: Все RDP-логины Ивана за сутки
  A: filter(category="auth" and user="ivanov" and service contains "rdp" and timestamp > now()-1d) | sort(timestamp desc)

  Q: Топ 10 хостов по числу critical-событий за неделю
  A: filter(level="critical" and timestamp > now()-7d) | group(host) | aggregate(count) | sort(count desc) | limit(10)

Q: {question}
A:"""

EXPLAIN_PROMPT = """\
Объясни простыми словами на русском, что произошло, и что делать в первые 10 минут.

Событие безопасности (SIGMA rule, MITRE ATT&CK техника, краткое описание):
{event}

Ответ должен быть кратким (не более 5 предложений) и заканчиваться списком рекомендаций.
"""


# ────────────────────────────────────────────────────────────────────────────
# FastAPI
# ────────────────────────────────────────────────────────────────────────────

app = FastAPI(title="URSUS LLM service", version="2.0.0")


class NlToPdqlReq(BaseModel):
    question: str = Field(..., description="Вопрос на естественном языке")


class NlToPdqlResp(BaseModel):
    pdql: str
    raw: str


@app.post("/nl-to-pdql", response_model=NlToPdqlResp)
def nl_to_pdql(req: NlToPdqlReq):
    prompt = NL_TO_PDQL_PROMPT.format(question=req.question.strip())
    try:
        out = infer(prompt, max_tokens=200, stop=["\nQ:", "\n\n"])
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))
    return NlToPdqlResp(pdql=out.strip(), raw=out)


class ExplainReq(BaseModel):
    event: str


class ExplainResp(BaseModel):
    explanation: str


@app.post("/explain", response_model=ExplainResp)
def explain(req: ExplainReq):
    prompt = EXPLAIN_PROMPT.format(event=req.event[:2000])
    try:
        out = infer(prompt, max_tokens=400, stop=["\n\n\n"])
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))
    return ExplainResp(explanation=out.strip())


class NarrativeReq(BaseModel):
    events: list[dict]


class NarrativeResp(BaseModel):
    summary: str


@app.post("/narrative", response_model=NarrativeResp)
def narrative(req: NarrativeReq):
    # Compress events into a compact timeline before sending to the model.
    lines = []
    for ev in req.events[:50]:
        ts = ev.get("timestamp", "")
        host = ev.get("host", "?")
        msg = (ev.get("message") or "")[:140]
        lines.append(f"  {ts} {host}: {msg}")
    if not lines:
        return NarrativeResp(summary="(нет событий)")
    prompt = (
        "Составь связный рассказ инцидента на русском по списку событий. "
        "Включи: время начала, ключевые шаги атакующего, потенциальное "
        "воздействие. Кратко (5–8 предложений).\n\nСобытия:\n"
        + "\n".join(lines)
        + "\n\nРассказ:"
    )
    try:
        out = infer(prompt, max_tokens=500, stop=["\n\n\n"])
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))
    return NarrativeResp(summary=out.strip())


class ParseFormatReq(BaseModel):
    samples: list[str]


class ParseFormatResp(BaseModel):
    pattern: str
    fields: list[str]


@app.post("/parse-format", response_model=ParseFormatResp)
def parse_format(req: ParseFormatReq):
    prompt = (
        "Дай регулярное выражение с именованными группами (Go regexp), "
        "которое разбирает все эти строки лога. Перечисли извлекаемые поля.\n\n"
        + "\n".join(s[:300] for s in req.samples[:10])
        + "\n\nRegex:"
    )
    try:
        out = infer(prompt, max_tokens=300, stop=["\n\n"])
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))
    # Naive parse of model output — first line = pattern; remaining = fields.
    lines = [l for l in out.splitlines() if l.strip()]
    pattern = lines[0] if lines else ""
    fields = [l.lstrip("- ").strip() for l in lines[1:6]]
    return ParseFormatResp(pattern=pattern, fields=fields)


@app.get("/health")
def health():
    try:
        get_model()
        return {"status": "ok"}
    except Exception as e:
        return {"status": "degraded", "error": str(e)}
