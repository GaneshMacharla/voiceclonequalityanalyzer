from __future__ import annotations

from typing import Any

WEIGHTS = {
    "speaker_similarity": 40,
    "content_accuracy": 15,
    "acoustic_similarity": 15,
    "pitch_similarity": 10,
    "prosody_similarity": 10,
    "speaking_rate_similarity": 5,
    "audio_quality": 5,
}


def category(score: int | None) -> str:
    if score is None:
        return "Unavailable"
    if score >= 90:
        return "Excellent"
    if score >= 80:
        return "Very Good"
    if score >= 70:
        return "Good"
    if score >= 60:
        return "Fair"
    return "Poor"


def score(metrics: dict[str, Any]) -> dict[str, Any]:
    available = {key: value for key, value in metrics.items() if key in WEIGHTS and value is not None}
    if not available:
        return {"overall_score": None, "category": "Unavailable", "weights": WEIGHTS}
    weight_total = sum(WEIGHTS[key] for key in available)
    overall = round(sum(value * WEIGHTS[key] for key, value in available.items()) / weight_total)
    return {"overall_score": overall, "category": category(overall), "weights": WEIGHTS, "available_dimensions": list(available)}
