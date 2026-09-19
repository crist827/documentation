"""Servicio de scoring para una muestra individual.

    pip install fastapi uvicorn
    uvicorn src.api.main:app --reload

El laboratorio manda el resultado de una muestra y recibe el riesgo. Requiere el
historial reciente del componente, porque casi todas las features son tendencias:
un modelo de mantenimiento predictivo que acepta una muestra aislada está
ignorando la mitad de la señal.
"""

from __future__ import annotations

from datetime import date

import joblib
import pandas as pd
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from src.config import MODELS_DIR
from src.features.build_features import ANALYTES

app = FastAPI(title="Riesgo de falla por análisis de aceite", version="1.0.0")

_bundle = None


def _get_bundle():
    global _bundle
    if _bundle is None:
        path = MODELS_DIR / "model.joblib"
        if not path.exists():
            raise HTTPException(503, "Modelo no entrenado. Ejecutar `make train`.")
        _bundle = joblib.load(path)
    return _bundle


class Sample(BaseModel):
    sample_id: str
    unit_id: str
    component: str = Field(..., description="engine | transmission | hydraulic | final_drive")
    sample_date: date
    unit_hours: float
    oil_hours: float
    oil_changed: bool = False
    equipment_model: str = "desconocido"

    fe_ppm: float = 0.0
    cu_ppm: float = 0.0
    cr_ppm: float = 0.0
    pb_ppm: float = 0.0
    al_ppm: float = 0.0
    sn_ppm: float = 0.0
    si_ppm: float = 0.0
    na_ppm: float = 0.0
    k_ppm: float = 0.0
    pq_index: float = 0.0
    water_pct: float = 0.0
    fuel_pct: float = 0.0
    soot_pct: float = 0.0
    tbn: float = 0.0
    visc_100c: float = 0.0
    oxidation_abs: float = 0.0


class ScoreRequest(BaseModel):
    """Muestra a evaluar más su historial, en orden cronológico."""

    history: list[Sample] = Field(
        default_factory=list,
        description="Muestras anteriores del MISMO unit_id+component (mín. 2 recomendadas).",
    )
    sample: Sample


class ScoreResponse(BaseModel):
    unit_id: str
    component: str
    risk_score: float
    alert: bool
    threshold: float
    n_history_samples: int
    warning: str | None = None


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "model_loaded": (MODELS_DIR / "model.joblib").exists()}


@app.post("/score", response_model=ScoreResponse)
def score(req: ScoreRequest) -> ScoreResponse:
    bundle = _get_bundle()
    model, builder = bundle["model"], bundle["builder"]

    rows = [s.model_dump() for s in [*req.history, req.sample]]
    df = pd.DataFrame(rows)
    df["sample_date"] = pd.to_datetime(df["sample_date"])
    for col in ANALYTES:
        df[col] = df[col].astype(float)

    mismatched = df[["unit_id", "component"]].drop_duplicates()
    if len(mismatched) > 1:
        raise HTTPException(422, "El historial debe ser del mismo unit_id y component.")

    feats = builder.transform(df)
    current = feats.iloc[[-1]]
    risk = float(model.predict_proba(current[bundle["feature_names"]])[:, 1][0])
    threshold = float(bundle["threshold"])

    warning = None
    if len(req.history) < 2:
        warning = (
            "Historial insuficiente: las features de tendencia salen nulas y el "
            "score pierde precisión. Enviar al menos 2 muestras anteriores."
        )

    return ScoreResponse(
        unit_id=req.sample.unit_id,
        component=req.sample.component,
        risk_score=risk,
        alert=risk >= threshold,
        threshold=threshold,
        n_history_samples=len(req.history),
        warning=warning,
    )
