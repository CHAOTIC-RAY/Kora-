"""
Thin FastAPI wrapper around VoxLibri (https://github.com/Vasanth2005kk/VoxLibri).

Run from this directory after cloning VoxLibri:
  export VOXLIBRI_HOME=/path/to/VoxLibri
  pip install -r requirements.txt
  uvicorn server:app --host 0.0.0.0 --port 7861
"""

from __future__ import annotations

import os
import shutil
import sys
import threading
import uuid
import zipfile
from pathlib import Path
from typing import Any

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

VOXLIBRI_HOME = os.environ.get("VOXLIBRI_HOME")
if not VOXLIBRI_HOME:
    raise SystemExit("Set VOXLIBRI_HOME to your VoxLibri clone before starting this server.")

VOXLIBRI_HOME = str(Path(VOXLIBRI_HOME).resolve())
sys.path.insert(0, VOXLIBRI_HOME)
os.chdir(VOXLIBRI_HOME)

import lib.core as core  # noqa: E402
from lib.core import SessionContext, SessionTracker, convert_ebook  # noqa: E402

core.context = SessionContext()
core.context_tracker = SessionTracker()
core.active_sessions = set()

WORK_DIR = Path(__file__).resolve().parent / "work"
WORK_DIR.mkdir(parents=True, exist_ok=True)

jobs: dict[str, dict[str, Any]] = {}
jobs_lock = threading.Lock()

app = FastAPI(title="Kora VoxLibri API", version="1.0.0")
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


def _collect_audio_files(path: Path) -> list[Path]:
    if not path.exists():
        return []
    if path.is_file() and path.suffix.lower() in {".mp3", ".m4b", ".wav", ".flac", ".ogg"}:
        return [path]
    files: list[Path] = []
    for ext in ("*.mp3", "*.m4b", "*.wav", "*.flac", "*.ogg"):
        files.extend(path.rglob(ext))
    return sorted(files, key=lambda p: p.name.lower())


def _zip_outputs(files: list[Path], dest: Path) -> Path:
    with zipfile.ZipFile(dest, "w", zipfile.ZIP_DEFLATED) as zf:
        for file in files:
            zf.write(file, arcname=file.name)
    return dest


def _run_conversion(
    job_id: str,
    ebook_path: Path,
    language: str,
    tts_engine: str,
    output_format: str,
    voice_path: str | None,
) -> None:
    try:
        _set_job(job_id, status="running", progress=5, message="Initialising VoxLibri session…")
        core.context.set_session(job_id)

        args = {
            "id": job_id,
            "ebook": str(ebook_path),
            "ebook_list": None,
            "language": language,
            "device": os.environ.get("VOXLIBRI_DEVICE", "cpu"),
            "tts_engine": tts_engine,
            "fine_tuned": "internal",
            "voice": voice_path,
            "custom_model": None,
            "output_format": output_format,
            "output_channel": "mono",
            "output_split": output_format == "mp3",
            "output_split_hours": 2.0,
            "chapters_preview": False,
            "audiobooks_dir": str(WORK_DIR / job_id / "output"),
            "script_mode": "native",
            "is_gui_process": False,
        }

        _set_job(job_id, progress=15, message="Converting ebook to audiobook…")
        msg, ok = convert_ebook(args)
        session = core.context.get_session(job_id) or {}
        output_path = session.get("audiobook")

        if not ok or not output_path:
            raise RuntimeError(msg or "VoxLibri conversion failed")

        output = Path(str(output_path))
        audio_files = _collect_audio_files(output)
        if not audio_files and output.parent.exists():
            audio_files = _collect_audio_files(output.parent)

        if not audio_files:
            raise RuntimeError("Conversion finished but no audio files were found")

        zip_path = WORK_DIR / job_id / "audiobook.zip"
        zip_path.parent.mkdir(parents=True, exist_ok=True)
        _zip_outputs(audio_files, zip_path)

        _set_job(
            job_id,
            status="done",
            progress=100,
            message=f"Converted {len(audio_files)} audio file(s)",
            download=zip_path.name,
            track_count=len(audio_files),
        )
    except Exception as exc:  # noqa: BLE001
        _set_job(job_id, status="failed", progress=100, message=str(exc), error=str(exc))


@app.get("/api/health")
def health() -> dict[str, Any]:
    return {
        "ok": True,
        "engine": "voxlibri",
        "home": VOXLIBRI_HOME,
        "device": os.environ.get("VOXLIBRI_DEVICE", "cpu"),
    }


@app.post("/api/convert")
async def convert(
    file: UploadFile = File(...),
    language: str = Form("eng"),
    tts_engine: str = Form("xtts"),
    output_format: str = Form("mp3"),
) -> dict[str, str]:
    job_id = uuid.uuid4().hex
    job_dir = WORK_DIR / job_id
    job_dir.mkdir(parents=True, exist_ok=True)

    suffix = Path(file.filename or "book.epub").suffix or ".epub"
    ebook_path = job_dir / f"source{suffix}"
    with ebook_path.open("wb") as out:
        shutil.copyfileobj(file.file, out)

    _set_job(
        job_id,
        status="queued",
        progress=0,
        message="Queued",
        language=language,
        tts_engine=tts_engine,
        output_format=output_format,
    )

    thread = threading.Thread(
        target=_run_conversion,
        args=(job_id, ebook_path, language, tts_engine, output_format, None),
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

    zip_path = WORK_DIR / job_id / job["download"]
    if not zip_path.exists():
        raise HTTPException(status_code=404, detail="Output file missing")

    return FileResponse(
        zip_path,
        media_type="application/zip",
        filename=f"voxlibri-{job_id}.zip",
    )
