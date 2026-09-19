"""Scoring batch: el entregable que realmente usa mantenimiento.

    python -m src.models.predict --top 20

Produce un ranking de los componentes más riesgosos de la flota, con el motivo
tribológico de cada alerta. Un score sin explicación no lo acciona nadie: el
planificador necesita saber si va a buscar un rodamiento o una entrada de tierra.
"""

from __future__ import annotations

import argparse

import joblib
import numpy as np
import pandas as pd

from src.config import CONDEMNING_LIMITS, MODELS_DIR, REPORTS_DIR
from src.data.load import load_raw

# Firmas diagnósticas: qué analitos apuntan a qué modo de falla.
SIGNATURES = {
    "desgaste abrasivo (ingreso de tierra)": ["si_ppm", "fe_ppm", "cr_ppm"],
    "falla de rodamiento / cojinete": ["pb_ppm", "cu_ppm", "sn_ppm", "pq_index"],
    "ingreso de refrigerante": ["na_ppm", "k_ppm", "water_pct"],
    "dilución por combustible": ["fuel_pct"],
    "sobrecarga térmica / hollín": ["soot_pct", "oxidation_abs"],
}


def _diagnose(row: pd.Series, reference: pd.DataFrame) -> str:
    """Modo de falla más probable según qué analitos se despegan de la flota."""
    comp = row["component"]
    scores = {}
    for mode, analytes in SIGNATURES.items():
        ratios = []
        for a in analytes:
            ref = reference.loc[comp, f"{a}_ref"]
            if ref and not np.isnan(ref):
                ratios.append(row[a] / ref)
        scores[mode] = float(np.mean(ratios)) if ratios else 0.0

    mode, ratio = max(scores.items(), key=lambda kv: kv[1])
    if ratio < 1.5:
        return "sin firma dominante (revisar tendencia)"
    return f"{mode} (×{ratio:.1f} vs. flota)"


def _limits_exceeded(row: pd.Series) -> str:
    over = [
        f"{col}={row[col]:g} (>{limit:g})"
        for col, limit in CONDEMNING_LIMITS.items()
        if row[col] > limit
    ]
    return "; ".join(over) if over else "ninguno"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--top", type=int, default=20, help="componentes a listar")
    parser.add_argument("--model", default=str(MODELS_DIR / "model.joblib"))
    args = parser.parse_args()

    bundle = joblib.load(args.model)
    model, builder = bundle["model"], bundle["builder"]
    feature_names, threshold = bundle["feature_names"], bundle["threshold"]

    raw = load_raw()
    feats = builder.transform(raw)

    # En producción se scorea la ÚLTIMA muestra de cada componente: es el estado
    # actual conocido de la flota.
    latest = (
        feats.sort_values("sample_date")
        .groupby(["unit_id", "component"], as_index=False)
        .tail(1)
        .reset_index(drop=True)
    )

    latest["risk_score"] = model.predict_proba(latest[feature_names])[:, 1]
    latest["alerta"] = np.where(latest["risk_score"] >= threshold, "SÍ", "no")
    latest["diagnostico"] = latest.apply(_diagnose, axis=1, reference=builder.reference_)
    latest["limites_superados"] = latest.apply(_limits_exceeded, axis=1)

    ranked = latest.sort_values("risk_score", ascending=False).reset_index(drop=True)

    out_cols = [
        "unit_id", "equipment_model", "component", "sample_date", "unit_hours",
        "oil_hours", "risk_score", "alerta", "diagnostico", "limites_superados",
        "fe_ppm", "cu_ppm", "si_ppm", "pq_index", "tbn",
    ]
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    out_path = REPORTS_DIR / "fleet_risk_ranking.csv"
    ranked[out_cols].to_csv(out_path, index=False)

    n_alert = int((ranked["alerta"] == "SÍ").sum())
    print(f"Componentes evaluados: {len(ranked):,}")
    print(f"Sobre el umbral ({threshold:.3f}): {n_alert}\n")

    show = ranked.head(args.top)[
        ["unit_id", "component", "sample_date", "risk_score", "diagnostico", "fe_ppm", "pq_index"]
    ].copy()
    show["sample_date"] = show["sample_date"].dt.strftime("%Y-%m-%d")
    print(show.to_string(index=False, float_format=lambda v: f"{v:.3f}"))
    print(f"\nRanking completo en {out_path}")


if __name__ == "__main__":
    main()
