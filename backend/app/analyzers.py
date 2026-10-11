from __future__ import annotations

from pathlib import Path
from typing import Any

import numpy as np
import soundfile as sf


def _read(path: Path) -> tuple[np.ndarray, int]:
    samples, sample_rate = sf.read(path, always_2d=False, dtype="float32")
    if samples.ndim > 1:
        samples = samples.mean(axis=1)
    return samples, sample_rate


def _rms(samples: np.ndarray) -> float:
    return float(np.sqrt(np.mean(np.square(samples)))) if samples.size else 0.0


def _zero_crossing_rate(samples: np.ndarray) -> float:
    if samples.size < 2:
        return 0.0
    return float(np.mean(np.abs(np.diff(np.signbit(samples)))))


def _silence_ratio(samples: np.ndarray, threshold: float = 0.01) -> float:
    return float(np.mean(np.abs(samples) < threshold)) if samples.size else 1.0


def _similarity(left: float, right: float, scale: float) -> int:
    return max(0, min(100, round(100 - abs(left - right) * scale)))


def analyze_pair(reference_path: Path, clone_path: Path) -> dict[str, Any]:
    reference, reference_rate = _read(reference_path)
    clone, clone_rate = _read(clone_path)
    reference_duration = len(reference) / reference_rate if reference_rate else 0.0
    clone_duration = len(clone) / clone_rate if clone_rate else 0.0
    duration_delta = abs(reference_duration - clone_duration)
    duration_similarity = _similarity(reference_duration, clone_duration, 100 / max(reference_duration, clone_duration, 1))
    reference_rms = _rms(reference)
    clone_rms = _rms(clone)
    acoustic_similarity = _similarity(reference_rms, clone_rms, 220)
    pitch_similarity = _similarity(_zero_crossing_rate(reference), _zero_crossing_rate(clone), 250)
    quality = max(0, min(100, round(100 - abs(reference_rate - clone_rate) / 1000 * 3 - abs(_silence_ratio(reference) - _silence_ratio(clone)) * 20)))
    return {
        "speaker_similarity": None,
        "content_accuracy": None,
        "acoustic_similarity": acoustic_similarity,
        "pitch_similarity": pitch_similarity,
        "prosody_similarity": duration_similarity,
        "speaking_rate_similarity": duration_similarity,
        "audio_quality": quality,
        "overall_score": None,
        "raw": {
            "reference_duration": reference_duration,
            "clone_duration": clone_duration,
            "duration_delta": duration_delta,
            "reference_sample_rate": reference_rate,
            "clone_sample_rate": clone_rate,
            "reference_rms": reference_rms,
            "clone_rms": clone_rms,
            "reference_silence_ratio": _silence_ratio(reference),
            "clone_silence_ratio": _silence_ratio(clone),
        },
        "model_status": {"speaker": "not_configured", "speech": "not_configured"},
    }
