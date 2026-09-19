"""Métricas alineadas con la decisión de mantenimiento, no con el paper.

Con un 1% de positivos, el accuracy es inútil: predecir "nunca falla" da 99%.
Lo que importa es el ranking: si el equipo de mantenimiento puede inspeccionar
10 componentes por semana, ¿cuántas fallas reales caen en ese top-10?
"""

from __future__ import annotations

import numpy as np
from sklearn.metrics import average_precision_score, roc_auc_score

from src.config import COST_INSPECTION, COST_UNPLANNED_FAILURE, INSPECTION_CAPACITY


def precision_recall_at_k(y_true, y_score, k_frac: float = INSPECTION_CAPACITY) -> dict:
    """Precisión y recall sobre el top-K% del ranking de riesgo."""
    y_true = np.asarray(y_true)
    y_score = np.asarray(y_score)
    n_k = max(int(round(len(y_true) * k_frac)), 1)

    order = np.argsort(-y_score, kind="stable")
    top = y_true[order][:n_k]
    hits = int(top.sum())
    total_pos = int(y_true.sum())

    return {
        "k_frac": k_frac,
        "n_inspected": n_k,
        f"precision_at_{int(k_frac * 100)}pct": hits / n_k,
        f"recall_at_{int(k_frac * 100)}pct": hits / total_pos if total_pos else float("nan"),
        "hits": hits,
        "positives": total_pos,
    }


def lift_at_k(y_true, y_score, k_frac: float = INSPECTION_CAPACITY) -> float:
    """Cuántas veces mejor que elegir al azar. Es el número que entiende un gerente."""
    res = precision_recall_at_k(y_true, y_score, k_frac)
    base_rate = np.asarray(y_true).mean()
    key = f"precision_at_{int(k_frac * 100)}pct"
    return res[key] / base_rate if base_rate > 0 else float("nan")


def expected_cost(y_true, y_score, threshold: float) -> float:
    """Costo total esperado de operar con un umbral dado.

    - Inspeccionar cuesta poco y evita la falla (asumimos detección efectiva).
    - No inspeccionar un componente que falla cuesta la parada no programada.
    """
    y_true = np.asarray(y_true)
    flagged = np.asarray(y_score) >= threshold
    n_inspections = int(flagged.sum())
    missed_failures = int(((~flagged) & (y_true == 1)).sum())
    return n_inspections * COST_INSPECTION + missed_failures * COST_UNPLANNED_FAILURE


def optimal_threshold(y_true, y_score, n_grid: int = 200) -> tuple[float, float]:
    """Umbral que minimiza el costo esperado, y ese costo.

    Se elige en validación y se APLICA tal cual en test. Elegirlo en test es
    otra forma de hacer trampa.
    """
    grid = np.quantile(np.asarray(y_score), np.linspace(0.0, 0.999, n_grid))
    costs = [expected_cost(y_true, y_score, t) for t in grid]
    best = int(np.argmin(costs))
    return float(grid[best]), float(costs[best])


def baseline_cost_do_nothing(y_true) -> float:
    """Costo de no hacer nada: todas las fallas ocurren sin aviso."""
    return float(np.asarray(y_true).sum()) * COST_UNPLANNED_FAILURE


def evaluate(y_true, y_score, label: str = "") -> dict:
    """Paquete completo de métricas para un conjunto."""
    y_true = np.asarray(y_true)
    y_score = np.asarray(y_score)
    out = {
        "split": label,
        "n": int(len(y_true)),
        "positives": int(y_true.sum()),
        "base_rate": float(y_true.mean()),
        "pr_auc": float(average_precision_score(y_true, y_score)),
        "roc_auc": float(roc_auc_score(y_true, y_score)),
        "lift_at_10pct": float(lift_at_k(y_true, y_score)),
    }
    out.update(precision_recall_at_k(y_true, y_score))
    return out
