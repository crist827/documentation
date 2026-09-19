"""Invariantes del dominio tribológico codificados como tests."""

import numpy as np
import pandas as pd

from src.features.build_features import ANALYTES, FeatureBuilder


def test_los_deltas_no_cruzan_un_cambio_de_aceite(raw_df):
    """Comparar ppm antes y después de un cambio de aceite no tiene sentido físico."""
    builder = FeatureBuilder().fit(raw_df)
    feats = builder.transform(raw_df)

    cruza = feats["prev_sample_oil_changed"] == 1
    assert cruza.sum() > 0, "El dataset de prueba no tiene cambios de aceite."
    for col in ANALYTES:
        assert feats.loc[cruza, f"{col}_delta"].isna().all()
        assert feats.loc[cruza, f"{col}_rate100h"].isna().all()


def test_la_tasa_de_desgaste_normaliza_por_horas_de_aceite(raw_df):
    """80 ppm con 100 h de aceite debe puntuar mucho peor que con 800 h.

    Es el invariante central del dominio: el nivel crudo de un metal no dice
    nada sin la edad del aceite que lo acumuló.
    """
    builder = FeatureBuilder().fit(raw_df)

    # Se fija el hierro en un valor constante para aislar el efecto de las horas.
    fijo = raw_df.copy()
    fijo["fe_ppm"] = 80.0
    feats = builder.transform(fijo)

    esperado = feats["fe_ppm"] / feats["oil_hours"].clip(lower=10.0) * 100.0
    np.testing.assert_allclose(feats["fe_ppm_per100h"], esperado)

    # A igual ppm, más horas de aceite implican menor tasa: relación estrictamente
    # decreciente sobre todo el rango observado.
    orden = feats.sort_values("oil_hours")
    tasas = orden["fe_ppm_per100h"].to_numpy()
    assert np.all(np.diff(tasas) <= 1e-9)
    assert tasas[0] > tasas[-1]


def test_la_primera_muestra_de_cada_componente_no_tiene_delta(raw_df):
    builder = FeatureBuilder().fit(raw_df)
    feats = builder.transform(raw_df)
    primeras = feats[feats["sample_index"] == 0]
    assert len(primeras) == feats.groupby(["unit_id", "component"]).ngroups
    assert primeras["fe_ppm_delta"].isna().all()


def test_las_ventanas_moviles_incluyen_la_muestra_actual(raw_df):
    """Un máximo móvil nunca puede quedar por debajo del valor actual."""
    builder = FeatureBuilder().fit(raw_df)
    feats = builder.transform(raw_df)
    valido = feats["fe_ppm_roll3_max"].notna()
    assert (feats.loc[valido, "fe_ppm_roll3_max"] >= feats.loc[valido, "fe_ppm"] - 1e-9).all()


def test_las_banderas_de_limite_coinciden_con_los_umbrales(raw_df):
    from src.config import CONDEMNING_LIMITS

    builder = FeatureBuilder().fit(raw_df)
    feats = builder.transform(raw_df)
    for col, limit in CONDEMNING_LIMITS.items():
        pd.testing.assert_series_equal(
            feats[f"over_limit_{col}"],
            (feats[col] > limit).astype(int),
            check_names=False,
        )
