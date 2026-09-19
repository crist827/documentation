"""Los tests que separan un proyecto de tutorial de uno que se puede desplegar.

Si estos pasan, el número que reporta `train.py` significa algo. Si no existieran,
el modelo podría estar viendo el futuro y nadie se enteraría hasta producción.
"""

import numpy as np
import pandas as pd

from src.config import HORIZON_DAYS, LEAKY_COLS, TRAIN_CUTOFF_QUANTILE, VALID_CUTOFF_QUANTILE
from src.data.load import temporal_split
from src.features.build_features import FeatureBuilder


def test_ninguna_columna_contaminada_llega_al_modelo(raw_df):
    """`lab_recommendation` es casi el label disfrazado: no puede ser feature."""
    builder = FeatureBuilder().fit(raw_df)
    builder.transform(raw_df)
    assert not set(builder.feature_names_) & set(LEAKY_COLS)


def test_las_features_no_miran_el_futuro(raw_df):
    """Perturbar el futuro no debe alterar las features del pasado.

    Es la prueba directa —y la más difícil de engañar— de ausencia de leakage
    temporal: se duplica el dataset, se corrompen las últimas muestras de cada
    componente, y se exige que las filas anteriores salgan idénticas.
    """
    builder = FeatureBuilder().fit(raw_df)
    base = builder.transform(raw_df)

    corrupted = raw_df.copy()
    # Últimas 3 muestras de cada componente: valores absurdos.
    tail_idx = (
        corrupted.sort_values("sample_date")
        .groupby(["unit_id", "component"])
        .tail(3)
        .index
    )
    for col in ["fe_ppm", "cu_ppm", "si_ppm", "pq_index", "tbn"]:
        corrupted.loc[tail_idx, col] = 9999.0

    after = builder.transform(corrupted)

    key = ["unit_id", "component", "sample_date"]
    base_i = base.set_index(key).sort_index()
    after_i = after.set_index(key).sort_index()

    # Filas intactas: todas menos las tres últimas de cada componente.
    untouched = ~base_i.index.isin(corrupted.loc[tail_idx].set_index(key).index)
    numeric = [c for c in builder.feature_names_]

    left = base_i.loc[untouched, numeric].to_numpy(dtype=float)
    right = after_i.loc[untouched, numeric].to_numpy(dtype=float)
    assert np.allclose(left, right, equal_nan=True), (
        "Alguna feature cambió al modificar muestras futuras: hay leakage temporal."
    )


def test_la_particion_temporal_no_se_solapa(raw_df):
    train, valid, test = temporal_split(raw_df)
    assert train["sample_date"].max() < valid["sample_date"].min()
    assert valid["sample_date"].max() < test["sample_date"].min()
    assert len(train) + len(valid) + len(test) == len(raw_df)


def test_la_referencia_de_flota_se_ajusta_solo_con_train(raw_df):
    """Ajustar la referencia sobre todo el dataset filtraría el futuro."""
    t_cut = raw_df["sample_date"].quantile(TRAIN_CUTOFF_QUANTILE)
    only_train = FeatureBuilder().fit(raw_df[raw_df["sample_date"] <= t_cut])
    everything = FeatureBuilder().fit(raw_df)
    assert not only_train.reference_.equals(everything.reference_), (
        "La referencia no cambia entre train y dataset completo: revisar el fit()."
    )


def test_el_label_respeta_el_horizonte(raw_df):
    """label == 1 si y solo si hay falla dentro del horizonte definido."""
    esperado = (
        raw_df["days_to_failure"].notna() & (raw_df["days_to_failure"] <= HORIZON_DAYS)
    ).astype(int)
    pd.testing.assert_series_equal(raw_df["label"], esperado, check_names=False)
    # Y nunca marca una falla ya ocurrida como futura.
    assert (raw_df.loc[raw_df["label"] == 1, "days_to_failure"] >= 0).all()
