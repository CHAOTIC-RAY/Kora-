"""
Thin FastAPI wrapper around VocalBook (https://github.com/ColbyStarr/vocalbook).

Run from this directory after cloning VocalBook:
  export VOCALBOOK_HOME=/path/to/vocalbook
  pip install -r requirements.txt
  uvicorn server:app --host 0.0.0.0 --port 7862

VocalBook requires at least one RVC model in rvc_models/ and a configs.json entry.
"""

from __future__ import annotations

import json
import os
import shutil
import sys
import threading
import uuid
from pathlib import Path
from typing import Any

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

VOCALBOOK_HOME = os.environ.get("VOCALBOOK_HOME")
if not VOCALBOOK_HOME:
    raise SystemExit("Set VOCALBOOK_HOME to your vocalbook clone before starting this server.")

VOCALBOOK_HOME = str(Path(VOCALBOOK_HOME).resolve())
sys.path.insert(0, VOCALBOOK_HOME)
os.chdir(VOCALBOOK_HOME)

from services.config import get_config, get_configs, write_to_configs  # noqa: E402
from services.job import Job, write_job_to_file  # noqa: E402

WORK_DIR = Path(__file__).resolve().parent / "work"
WORK_DIR.mkdir(parents=True, exist_ok=True)

jobs: dict[str, dict[str, Any]] = {}
jobs_lock = threading.Lock()

app = FastAPI(title="Kora VocalBook API", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _set_job(job_id: str, **patch: Any) -> None:
    with jobs_lock:
        jobs.setdefault(job_id, {})
        jobs[job_id].update(patch)


def _ensure_configs_file() -> None:
    configs_path = Path("configs.json")
    if not configs_path.exists():
        configs_path.write_text("{}", encoding="utf-8")


def _resolve_config(config_name: str | None, tts_model: str, tts_voice: str, rvc_model: str) -> str:
    _ensure_configs_file()
    name = (config_name or "kora_default").strip()
    existing = get_config(name)
    if existing:
        return name

    config = {
        "tts_model": tts_model,
        "tts_voice": tts_voice,
        "tts_pitch": 0,
        "tts_rate": 0,
        "rvc_model": rvc_model,
    }
    if tts_model == "coqui":
        config["tts_sample"] = tts_voice
        del config["tts_voice"]

    write_to_configs(name, config)
    return name


def _run_job(job_id: str, input_name: str, config_name: str, batch_size: int) -> None:
    try:
        os.chdir(VOCALBOOK_HOME)
        _set_job(job_id, status="running", progress=5, message="Starting VocalBook job…")
        write_job_to_file(job_id, config_name, input_name, batch_size)
        job = Job(job_id)

        def progress_watch() -> None:
            while True:
                with jobs_lock:
                    state = jobs.get(job_id, {})
                    if state.get("status") in {"done", "failed"}:
                        return
                try:
                    pct = job.get_job_progress()
                    _set_job(job_id, progress=max(5, min(99, pct)), message=f"Processing batch {job.completed_batches}/{job.total_chunks}")
                except Exception:
                    pass
                threading.Event().wait(2)

        watcher = threading.Thread(target=progress_watch, daemon=True)
        watcher.start()
        job.run_job()

        audio_path = Path("jobs") / job_id / "audio.mp3"
        if not audio_path.exists():
            raise RuntimeError("VocalBook finished but audio.mp3 was not created")

        dest = WORK_DIR / job_id / "audio.mp3"
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(audio_path, dest)

        _set_job(
            job_id,
            status="done",
            progress=100,
            message="Audiobook ready",
            download="audio.mp3",
            track_count=1,
        )
    except Exception as exc:  # noqa: BLE001
        _set_job(job_id, status="failed", progress=100, message=str(exc), error=str(exc))


@app.get("/api/health")
def health() -> dict[str, Any]:
    configs = {}
    try:
        _ensure_configs_file()
        configs = get_configs() or {}
    except Exception:
        configs = {}
    return {
        "ok": True,
        "engine": "vocalbook",
        "home": VOCALBOOK_HOME,
        "configCount": len(configs) if isinstance(configs, dict) else 0,
    }


@app.get("/api/configs")
def list_configs() -> dict[str, Any]:
    _ensure_configs_file()
    configs = get_configs() or {}
    return {"configs": configs}


@app.post("/api/convert")
async def convert(
    file: UploadFile = File(...),
    config_name: str | None = Form(None),
    tts_model: str = Form("edge"),
    tts_voice: str = Form("en-US-GuyNeural"),
    rvc_model: str = Form(""),
    batch_size: int = Form(5),
) -> dict[str, str]:
    if not rvc_model and not config_name:
        raise HTTPException(
            status_code=400,
            detail="Provide config_name or rvc_model (VocalBook requires an RVC voice model).",
        )

    job_id = uuid.uuid4().hex
    input_dir = Path("input")
    input_dir.mkdir(parents=True, exist_ok=True)

    suffix = Path(file.filename or "book.pdf").suffix or ".pdf"
    input_name = f"{job_id}{suffix}"
    input_path = input_dir / input_name
    with input_path.open("wb") as out:
        shutil.copyfileobj(file.file, out)

    resolved_config = _resolve_config(config_name, tts_model, tts_voice, rvc_model or "default")
    if not get_config(resolved_config):
        raise HTTPException(status_code=400, detail=f"Config '{resolved_config}' could not be created.")

    _set_job(job_id, status="queued", progress=0, message="Queued", config=resolved_config)

    thread = threading.Thread(
        target=_run_job,
        args=(job_id, input_name, resolved_config, max(1, min(batch_size, 100))),
        daemon=True,
    )
    thread.start()
    return {"jobId": job_id}


@app.get("/api/jobs/{job_id}")
def job_status(job_id: str) -> dict[str, Any]:
    with jobs_lock:
        job = jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return {
        "jobId": job_id,
        "status": job.get("status", "unknown"),
        "progress": job.get("progress", 0),
        "message": job.get("message", ""),
        "trackCount": job.get("track_count"),
        "error": job.get("error"),
    }


@app.get("/api/jobs/{job_id}/download")
def job_download(job_id: str) -> FileResponse:
    with jobs_lock:
        job = jobs.get(job_id)
    if not job or job.get("status") != "done" or not job.get("download"):
        raise HTTPException(status_code=404, detail="Audiobook not ready")

    audio_path = WORK_DIR / job_id / job["download"]
    if not audio_path.exists():
        raise HTTPException(status_code=404, detail="Output file missing")

    return FileResponse(
        audio_path,
        media_type="audio/mpeg",
        filename=f"vocalbook-{job_id}.mp3",
    )
