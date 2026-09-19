"""Construcción de features a partir de muestras crudas de aceite.

Tres reglas que gobiernan este módulo:

1. **Solo pasado y presente.** Toda ventana móvil se calcula dentro del grupo
   (unit_id, component) ordenado por fecha, e incluye como máximo la muestra
   actual. Nunca `shift(-1)`, nunca `.mean()` sobre el grupo completo.
2. **El nivel absoluto miente; la tasa informa.** 80 ppm de hierro con 40 h de
   aceite es una emergencia; los mismos 80 ppm con 480 h es rutina. Por eso casi
   todos los analitos se normalizan por horas de aceite.
3. **El cambio de aceite corta la serie.** Los deltas que cruzan un cambio de
   aceite comparan cosas distintas, así que se anulan explícitamente (NaN) en vez
   de dejar que el modelo aprenda un escalón artificial.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from src.config import CONDEMNING_LIMITS, ID_COLS, LEAKY_COLS

# Analitos que el laboratorio reporta y que existen al momento de predecir.
ANALYTES = [
    "fe_ppm", "cu_ppm", "cr_ppm", "pb_ppm", "al_ppm", "sn_ppm",
    "si_ppm", "na_ppm", "k_ppm", "pq_index",
    "water_pct", "fuel_pct", "soot_pct", "tbn", "visc_100c", "oxidation_abs",
]

# Metales de desgaste puro: su acumulación escala con las horas de aceite.
WEAR_METALS = ["fe_ppm", "cu_ppm", "cr_ppm", "pb_ppm", "al_ppm", "sn_ppm", "si_ppm", "pq_index"]

GROUP_KEYS = ["unit_id", "component"]
ROLLING_WINDOWS = (3, 5)


class FeatureBuilder:
    """Transformador con estado: aprende referencias de flota solo del train.

    La referencia por tipo de componente (mediana de cada analito) se ajusta
    únicamente con datos de entrenamiento. Calcularla sobre todo el dataset
    filtraría información del futuro hacia el pasado —un leakage sutil y muy
    común en proyectos de mantenimiento predictivo.
    """

    def __init__(self) -> None:
        self.reference_: pd.DataFrame | None = None
        self.feature_names_: list[str] = []

    # -- API ------------------------------------------------------------------

    def fit(self, df: pd.DataFrame) -> "FeatureBuilder":
        self.reference_ = (
            df.groupby("component")[ANALYTES].median().add_suffix("_ref")
        )
        return self

    def transform(self, df: pd.DataFrame) -> pd.DataFrame:
        if self.reference_ is None:
            raise RuntimeError("Llamar a fit() antes de transform().")

        out = df.sort_values(GROUP_KEYS + ["sample_date"]).reset_index(drop=True)

        # Cada bloque agrega decenas de columnas. pandas fragmenta el frame tras
        # tantas asignaciones sucesivas, así que se consolida entre bloques.
        for block in (
            self._temporal_context,
            self._normalize_by_oil_age,
            self._deltas_and_slopes,
            self._rolling,
            self._fleet_relative,
            self._condemning_flags,
        ):
            out = block(out).copy()

        self.feature_names_ = self._select_feature_names(out)
        return out

    def fit_transform(self, df: pd.DataFrame) -> pd.DataFrame:
        return self.fit(df).transform(df)

    # -- Bloques --------------------------------------------------------------

    @staticmethod
    def _temporal_context(df: pd.DataFrame) -> pd.DataFrame:
        g = df.groupby(GROUP_KEYS, sort=False)
        df["days_since_prev_sample"] = (
            df["sample_date"] - g["sample_date"].shift(1)
        ).dt.days
        df["hours_since_prev_sample"] = df["unit_hours"] - g["unit_hours"].shift(1)
        df["sample_index"] = g.cumcount()

        # Muestras transcurridas desde el último cambio de aceite.
        changed = g["oil_changed"].shift(1).fillna(False).astype(bool)
        charge_id = changed.groupby([df["unit_id"], df["component"]]).cumsum()
        df["oil_charge_id"] = charge_id
        df["samples_since_oil_change"] = df.groupby(
            GROUP_KEYS + ["oil_charge_id"], sort=False
        ).cumcount()
        df["prev_sample_oil_changed"] = changed.astype(int)
        return df

    @staticmethod
    def _normalize_by_oil_age(df: pd.DataFrame) -> pd.DataFrame:
        """Tasa de desgaste: ppm por cada 100 horas de aceite.

        Es la feature que más pesa en un análisis tribológico real y la que
        convierte un nivel ambiguo en una señal interpretable.
        """
        oil_h = df["oil_hours"].clip(lower=10.0)  # evita dividir por ~0 tras el cambio
        for col in WEAR_METALS:
            df[f"{col}_per100h"] = df[col] / oil_h * 100.0

        # Severidad del aceite en sí, no del metal.
        df["tbn_depletion_pct"] = np.where(
            df["component"] == "engine",
            (1 - df["tbn"] / 11.0).clip(0, 1) * 100,
            (1 - df["tbn"] / 7.0).clip(0, 1) * 100,
        )
        # Relaciones diagnósticas clásicas.
        df["pq_over_fe"] = df["pq_index"] / df["fe_ppm"].clip(lower=1.0)
        df["si_over_fe"] = df["si_ppm"] / df["fe_ppm"].clip(lower=1.0)
        df["cu_plus_pb_plus_sn"] = df["cu_ppm"] + df["pb_ppm"] + df["sn_ppm"]
        df["na_plus_k"] = df["na_ppm"] + df["k_ppm"]
        return df

    @staticmethod
    def _deltas_and_slopes(df: pd.DataFrame) -> pd.DataFrame:
        """Cambio respecto de la muestra anterior, anulado si hubo cambio de aceite."""
        g = df.groupby(GROUP_KEYS, sort=False)
        crosses_change = df["prev_sample_oil_changed"].astype(bool)

        for col in ANALYTES:
            prev = g[col].shift(1)
            delta = df[col] - prev
            # Un delta que cruza un cambio de aceite no es comparable.
            df[f"{col}_delta"] = delta.where(~crosses_change)
            # Tasa de cambio por cada 100 horas de operación.
            df[f"{col}_rate100h"] = (
                delta / df["hours_since_prev_sample"].clip(lower=1.0) * 100.0
            ).where(~crosses_change)
        return df

    @staticmethod
    def _rolling(df: pd.DataFrame) -> pd.DataFrame:
        """Ventanas móviles que incluyen la muestra actual y las anteriores."""
        key_cols = ["fe_ppm", "cu_ppm", "si_ppm", "pq_index", "tbn", "visc_100c", "pb_ppm"]
        g = df.groupby(GROUP_KEYS, sort=False)

        for window in ROLLING_WINDOWS:
            roll = g[key_cols].rolling(window, min_periods=2)
            means = roll.mean().reset_index(level=GROUP_KEYS, drop=True)
            stds = roll.std().reset_index(level=GROUP_KEYS, drop=True)
            maxs = roll.max().reset_index(level=GROUP_KEYS, drop=True)
            for col in key_cols:
                df[f"{col}_roll{window}_mean"] = means[col]
                df[f"{col}_roll{window}_std"] = stds[col]
                df[f"{col}_roll{window}_max"] = maxs[col]
                # Cuánto se despega la muestra actual de su propia historia
                # reciente: un z-score local por componente.
                df[f"{col}_roll{window}_z"] = (
                    (df[col] - means[col]) / stds[col].replace(0, np.nan)
                )
        return df

    def _fleet_relative(self, df: pd.DataFrame) -> pd.DataFrame:
        """Posición del analito frente a la mediana de su tipo de componente."""
        ref = self.reference_
        assert ref is not None
        joined = df[["component"]].join(ref, on="component")
        for col in ANALYTES:
            df[f"{col}_vs_fleet"] = df[col] / joined[f"{col}_ref"].replace(0, np.nan)
        return df

    @staticmethod
    def _condemning_flags(df: pd.DataFrame) -> pd.DataFrame:
        """Réplica de los límites condenatorios del laboratorio.

        Se incluyen como feature —no solo como baseline— porque codifican
        décadas de experiencia de mantenimiento que el modelo no tiene por qué
        redescubrir desde cero.
        """
        flags = []
        for col, limit in CONDEMNING_LIMITS.items():
            name = f"over_limit_{col}"
            df[name] = (df[col] > limit).astype(int)
            flags.append(name)
        df["n_limits_exceeded"] = df[flags].sum(axis=1)
        return df

    @staticmethod
    def _select_feature_names(df: pd.DataFrame) -> list[str]:
        """Todo lo numérico que no sea identificador, label ni columna contaminada."""
        blocked = set(ID_COLS) | set(LEAKY_COLS) | {"oil_charge_id", "equipment_model"}
        names = [
            c for c in df.columns
            if c not in blocked and pd.api.types.is_numeric_dtype(df[c])
        ]
        return names


def build(df: pd.DataFrame, builder: FeatureBuilder | None = None) -> tuple[pd.DataFrame, FeatureBuilder]:
    """Atajo funcional: devuelve el DataFrame con features y el builder ajustado."""
    builder = builder or FeatureBuilder()
    return builder.fit_transform(df), builder
