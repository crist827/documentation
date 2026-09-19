"""Baselines. Si el modelo no les gana, el modelo no va a producción.

El baseline que importa no es el azar: es lo que el laboratorio ya hace hoy con
los límites condenatorios. Ese es el estándar real a superar.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from src.config import CONDEMNING_LIMITS, RANDOM_SEED


def condemning_limits_score(df: pd.DataFrame) -> np.ndarray:
    """Severidad según límites condenatorios: suma de (valor / límite).

    Es exactamente la lógica de una planilla de mantenimiento: cuanto más lejos
    del límite, más urgente. Sirve como score continuo para rankear.
    """
    score = np.zeros(len(df), dtype=float)
    for col, limit in CONDEMNING_LIMITS.items():
        score += (df[col].to_numpy(dtype=float) / limit)
    return score


def wear_rate_score(df: pd.DataFrame) -> np.ndarray:
    """Baseline tribológico algo más fino: tasa de hierro por 100 h de aceite.

    Normalizar por la edad del aceite es el primer reflejo de cualquier analista
    con experiencia, y ya levanta bastante respecto del nivel crudo.
    """
    oil_h = df["oil_hours"].clip(lower=10.0).to_numpy(dtype=float)
    return df["fe_ppm"].to_numpy(dtype=float) / oil_h * 100.0


def random_score(df: pd.DataFrame, seed: int = RANDOM_SEED) -> np.ndarray:
    """Piso absoluto: orden aleatorio."""
    return np.random.default_rng(seed).random(len(df))


BASELINES = {
    "aleatorio": random_score,
    "limites_condenatorios": condemning_limits_score,
    "tasa_hierro_100h": wear_rate_score,
}
