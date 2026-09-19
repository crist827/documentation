"""Carga y partición temporal del dataset.

Para pasar a datos reales solo hay que reescribir `load_raw`: que lea de la base
de datos, del Excel exportado del laboratorio o del parser de PDFs S·O·S. El
resto del pipeline no se entera.
"""

from __future__ import annotations

import pandas as pd

from src.config import (
    DATA_RAW,
    TRAIN_CUTOFF_QUANTILE,
    VALID_CUTOFF_QUANTILE,
)

REQUIRED_COLUMNS = {
    "sample_id", "unit_id", "component", "sample_date",
    "unit_hours", "oil_hours", "oil_changed", "label",
}


def load_raw(path=None) -> pd.DataFrame:
    path = path or (DATA_RAW / "oil_samples.csv")
    df = pd.read_csv(path, parse_dates=["sample_date", "failure_date"])
    missing = REQUIRED_COLUMNS - set(df.columns)
    if missing:
        raise ValueError(f"Faltan columnas obligatorias: {sorted(missing)}")
    df["oil_changed"] = df["oil_changed"].astype(bool)
    return df.sort_values("sample_date").reset_index(drop=True)


def temporal_split(df: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    """Corta por fecha: train < valid < test, sin solapamiento.

    Por qué no `train_test_split` aleatorio: pondría muestras de marzo en train y
    de febrero en test del MISMO componente. El modelo vería el futuro y el
    resultado sería un número inflado que no se reproduce en producción. En
    mantenimiento predictivo esta es LA fuente de error.
    """
    t_cut = df["sample_date"].quantile(TRAIN_CUTOFF_QUANTILE)
    v_cut = df["sample_date"].quantile(VALID_CUTOFF_QUANTILE)

    train = df[df["sample_date"] <= t_cut]
    valid = df[(df["sample_date"] > t_cut) & (df["sample_date"] <= v_cut)]
    test = df[df["sample_date"] > v_cut]
    return (
        train.reset_index(drop=True),
        valid.reset_index(drop=True),
        test.reset_index(drop=True),
    )
