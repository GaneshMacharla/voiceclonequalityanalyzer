from __future__ import annotations

import asyncio
import uuid
from datetime import datetime, timezone
from pathlib import Path

from fastapi import BackgroundTasks, FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from app.analyzers import analyze_pair
from app.scoring import WEIGHTS, score

ROOT = Path(__file__).resolve().parents[2]
UPLOAD_DIR = ROOT / "data" / "uploads"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
MAX_FILE_SIZE = 100 * 1024 * 1024
ALLOWED_TYPES = {"audio/wav", "audio/x-wav", "audio/mpeg", "audio/mp4", "audio/flac", "audio/ogg"}

app = FastAPI(title="Voice Lens Analysis API", version="0.1.0")
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:5173", "http://localhost:5174"], allow_methods=["*"], allow_headers=["*"])

files: dict[str, dict] = {}
analyses: dict[str, dict] = {}


class AnalysisRequest(BaseModel):
    original_audio_id: str
    clone_audio_id: str


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


async def persist_upload(audio_id: str, upload: UploadFile) -> Path:
    destination = UPLOAD_DIR / f"{audio_id}{Path(upload.filename or '').suffix.lower()}"
    size = 0
    with destination.open("wb") as target:
        while chunk := await upload.read(1024 * 1024):
            size += len(chunk)
            if size > MAX_FILE_SIZE:
                destination.unlink(missing_ok=True)
                raise HTTPException(413, "Audio file exceeds the 100 MB limit")
            target.write(chunk)
    return destination


async def run_analysis(analysis_id: str) -> None:
    analysis = analyses[analysis_id]
    try:
        for stage in ["preprocessing", "speaker_analysis", "speech_analysis"]:
            analysis["status"] = stage
            await asyncio.sleep(0.15)
        original = files[analysis["original_audio_id"]]
        clone = files[analysis["clone_audio_id"]]
        analysis["status"] = "acoustic_analysis"
        metrics = analyze_pair(Path(original["path"]), Path(clone["path"]))
        analysis["status"] = "prosody_analysis"
        await asyncio.sleep(0.15)
        analysis["status"] = "scoring"
        metrics["scoring"] = score(metrics)
        analysis["metrics"] = metrics
        analysis["status"] = "completed"
        analysis["completed_at"] = now()
    except Exception as error:
        analysis["status"] = "failed"
        analysis["error"] = str(error)


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/audio/upload")
async def upload_audio(file: UploadFile = File(...)) -> dict:
    if file.content_type not in ALLOWED_TYPES:
        raise HTTPException(415, "Unsupported audio type")
    audio_id = str(uuid.uuid4())
    path = await persist_upload(audio_id, file)
    record = {"id": audio_id, "filename": file.filename, "content_type": file.content_type, "path": str(path), "created_at": now()}
    files[audio_id] = record
    return {key: value for key, value in record.items() if key != "path"}


@app.post("/api/analyses", status_code=202)
async def create_analysis(request: AnalysisRequest, background_tasks: BackgroundTasks) -> dict:
    if request.original_audio_id not in files or request.clone_audio_id not in files:
        raise HTTPException(404, "Both uploaded audio files are required")
    analysis_id = str(uuid.uuid4())
    analyses[analysis_id] = {"id": analysis_id, "status": "queued", "created_at": now(), "metrics": None, "original_audio_id": request.original_audio_id, "clone_audio_id": request.clone_audio_id}
    background_tasks.add_task(run_analysis, analysis_id)
    return analyses[analysis_id]


@app.get("/api/analyses/{analysis_id}")
def get_analysis(analysis_id: str) -> dict:
    if analysis_id not in analyses:
        raise HTTPException(404, "Analysis not found")
    return analyses[analysis_id]


@app.get("/api/scoring/weights")
def get_scoring_weights() -> dict[str, int]:
    return WEIGHTS


@app.delete("/api/audio/{audio_id}", status_code=204)
def delete_audio(audio_id: str) -> None:
    record = files.pop(audio_id, None)
    if record:
        Path(record["path"]).unlink(missing_ok=True)