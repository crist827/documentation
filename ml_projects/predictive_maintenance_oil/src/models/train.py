"""Entrenamiento, comparación contra baselines y selección de umbral por costo.

    python -m src.models.train

Produce en models/ el artefacto servible y en reports/ las métricas y la
importancia de features.
"""

from __future__ import annotations

import json

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.inspection import permutation_importance

from src.config import (
    LEAKY_COLS,
    MODELS_DIR,
    RANDOM_SEED,
    REPORTS_DIR,
    TRAIN_CUTOFF_QUANTILE,
    VALID_CUTOFF_QUANTILE,
)
from src.data.load import load_raw
from src.evaluation.metrics import (
    baseline_cost_do_nothing,
    evaluate,
    expected_cost,
    optimal_threshold,
)
from src.features.build_features import FeatureBuilder
from src.models.baselines import BASELINES


def _build_model(n_pos: int, n_neg: int):
    """Gradient boosting. LightGBM si está disponible; si no, el de scikit-learn.

    No hay redes neuronales acá y no es por pereza: en datos tabulares con ~20k
    filas y features diseñadas a mano, el boosting gana casi siempre, entrena en
    segundos y es mucho más fácil de auditar frente a un cliente.
    """
    try:
        from lightgbm import LGBMClassifier

        return LGBMClassifier(
            n_estimators=300,
            learning_rate=0.05,
            num_leaves=15,
            min_child_samples=40,
            reg_lambda=5.0,
            subsample=0.8,
            subsample_freq=1,
            colsample_bytree=0.7,
            scale_pos_weight=n_neg / max(n_pos, 1),
            random_state=RANDOM_SEED,
            verbose=-1,
        )
    except ImportError:
        return HistGradientBoostingClassifier(
            # Configuración elegida comparando en VALIDACIÓN (nunca en test).
            # Con ~150 positivos en train, un modelo poco regularizado memoriza:
            # bajar las hojas y subir l2 mejoró PR-AUC de 0.241 a 0.295.
            max_iter=300,
            learning_rate=0.05,
            max_leaf_nodes=15,
            min_samples_leaf=40,
            l2_regularization=5.0,
            early_stopping=False,
            random_state=RANDOM_SEED,
        )


def _assert_no_leakage(feature_names: list[str], train: pd.DataFrame, valid: pd.DataFrame) -> None:
    """Dos guardias que fallan ruidosamente antes de perder tiempo entrenando."""
    contaminated = sorted(set(feature_names) & set(LEAKY_COLS))
    if contaminated:
        raise AssertionError(f"Columnas con leakage en las features: {contaminated}")

    if train["sample_date"].max() >= valid["sample_date"].min():
        raise AssertionError("La partición temporal se solapa: train alcanza a validación.")


def main() -> None:
    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)

    raw = load_raw()

    # Las referencias de flota se ajustan SOLO con el tramo de entrenamiento...
    t_cut = raw["sample_date"].quantile(TRAIN_CUTOFF_QUANTILE)
    v_cut = raw["sample_date"].quantile(VALID_CUTOFF_QUANTILE)
    builder = FeatureBuilder().fit(raw[raw["sample_date"] <= t_cut])

    # ...pero las features se calculan sobre la serie COMPLETA y recién después
    # se corta. Suena a leakage y no lo es: todas las ventanas miran hacia atrás.
    # Transformar cada split por separado sí sería un error: las primeras muestras
    # de validación perderían su historial y el modelo las vería peor de lo que
    # las vería en producción, donde ese historial existe.
    feats = builder.transform(raw)
    feature_names = builder.feature_names_

    train = feats[feats["sample_date"] <= t_cut].reset_index(drop=True)
    valid = feats[(feats["sample_date"] > t_cut) & (feats["sample_date"] <= v_cut)].reset_index(drop=True)
    test = feats[feats["sample_date"] > v_cut].reset_index(drop=True)

    _assert_no_leakage(feature_names, train, valid)

    X_tr, y_tr = train[feature_names], train["label"].to_numpy()
    X_va, y_va = valid[feature_names], valid["label"].to_numpy()
    X_te, y_te = test[feature_names], test["label"].to_numpy()

    print(f"Features            : {len(feature_names)}")
    print(f"Train / Valid / Test: {len(train):,} / {len(valid):,} / {len(test):,}")
    print(f"Positivos           : {y_tr.sum()} / {y_va.sum()} / {y_te.sum()}")
    print(f"Corte train         : {t_cut:%Y-%m-%d}   corte valid: {v_cut:%Y-%m-%d}\n")

    model = _build_model(n_pos=int(y_tr.sum()), n_neg=int((1 - y_tr).sum()))
    if isinstance(model, HistGradientBoostingClassifier):
        # Sin scale_pos_weight nativo: se compensa con pesos por muestra.
        weight = np.where(y_tr == 1, (1 - y_tr).sum() / max(y_tr.sum(), 1), 1.0)
        model.fit(X_tr, y_tr, sample_weight=weight)
    else:
        model.fit(X_tr, y_tr)

    results = []

    # --- Baselines ----------------------------------------------------------
    for name, fn in BASELINES.items():
        results.append({**evaluate(y_va, fn(valid), f"valid/{name}"), "modelo": name})
        results.append({**evaluate(y_te, fn(test), f"test/{name}"), "modelo": name})

    # --- Modelo -------------------------------------------------------------
    p_va = model.predict_proba(X_va)[:, 1]
    p_te = model.predict_proba(X_te)[:, 1]
    results.append({**evaluate(y_va, p_va, "valid/modelo"), "modelo": "gradient_boosting"})
    results.append({**evaluate(y_te, p_te, "test/modelo"), "modelo": "gradient_boosting"})

    res_df = pd.DataFrame(results)
    cols = ["split", "modelo", "n", "positives", "pr_auc", "roc_auc",
            "precision_at_10pct", "recall_at_10pct", "lift_at_10pct"]
    print(res_df[cols].to_string(index=False, float_format=lambda v: f"{v:.3f}"))

    # --- Umbral por costo: se elige en validación, se aplica en test ---------
    thr, cost_va = optimal_threshold(y_va, p_va)
    cost_te = expected_cost(y_te, p_te, thr)
    do_nothing_te = baseline_cost_do_nothing(y_te)
    saving = do_nothing_te - cost_te

    print(f"\nUmbral óptimo (elegido en validación): {thr:.4f}")
    print(f"Costo en test sin programa de monitoreo : USD {do_nothing_te:>12,.0f}")
    print(f"Costo en test con el modelo             : USD {cost_te:>12,.0f}")
    print(f"Ahorro estimado                         : USD {saving:>12,.0f}"
          f"  ({saving / do_nothing_te:.1%})" if do_nothing_te else "")

    # --- Importancia por permutación ----------------------------------------
    # Se mide sobre validación, no sobre train: lo que importa es qué features
    # sostienen el rendimiento en datos no vistos.
    print("\nCalculando importancia por permutación...")
    imp = permutation_importance(
        model, X_va, y_va,
        scoring="average_precision",
        n_repeats=3,
        random_state=RANDOM_SEED,
        n_jobs=-1,
    )
    imp_df = (
        pd.DataFrame({"feature": feature_names, "importance": imp.importances_mean})
        .sort_values("importance", ascending=False)
        .reset_index(drop=True)
    )
    print(imp_df.head(15).to_string(index=False, float_format=lambda v: f"{v:.4f}"))

    # --- Persistencia -------------------------------------------------------
    joblib.dump(
        {"model": model, "builder": builder, "feature_names": feature_names, "threshold": thr},
        MODELS_DIR / "model.joblib",
    )
    res_df.to_csv(REPORTS_DIR / "metrics.csv", index=False)
    imp_df.to_csv(REPORTS_DIR / "feature_importance.csv", index=False)
    (REPORTS_DIR / "summary.json").write_text(
        json.dumps(
            {
                "threshold": thr,
                "cost_test_model": cost_te,
                "cost_test_do_nothing": do_nothing_te,
                "saving_pct": (saving / do_nothing_te) if do_nothing_te else None,
                "test": next(r for r in results if r["split"] == "test/modelo"),
            },
            indent=2,
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    print(f"\nModelo guardado en {MODELS_DIR / 'model.joblib'}")


if __name__ == "__main__":
    main()
