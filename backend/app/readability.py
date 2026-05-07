"""Flesch-Kincaid readability utilities."""

from __future__ import annotations

import textstat

from app.config import settings


def grade_level(text: str) -> float:
    """Return the Flesch-Kincaid grade level for a piece of text."""
    return textstat.flesch_kincaid_grade(text)


def is_high_difficulty(grade: float, threshold: float | None = None) -> bool:
    """Return True if the grade level exceeds the configured threshold."""
    limit = threshold if threshold is not None else settings.high_reading_difficulty_threshold
    return grade > limit
