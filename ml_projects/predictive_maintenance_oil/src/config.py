"""Parámetros del proyecto. Un solo lugar para tocar horizontes, rutas y umbrales."""

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA_RAW = ROOT / "data" / "raw"
DATA_PROCESSED = ROOT / "data" / "processed"
MODELS_DIR = ROOT / "models"
REPORTS_DIR = ROOT / "reports"

# --- Definición del problema -------------------------------------------------
# Horizonte de predicción: ¿falla este componente dentro de los próximos N días?
# 30 días es el compromiso habitual: alcanza para programar una intervención
# en una parada planificada, y es corto como para que la señal tribológica
# todavía sea informativa.
HORIZON_DAYS = 30

# Fracción de muestras que el mantenedor puede inspeccionar por período.
# Define la métrica operativa: precisión y recall sobre el top-K del ranking.
INSPECTION_CAPACITY = 0.10

# Costos relativos usados para elegir el umbral de decisión.
# Ajustar con números reales de la flota antes de usar en producción.
COST_UNPLANNED_FAILURE = 25_000.0  # USD: rotura, remolque, lucro cesante
COST_INSPECTION = 800.0            # USD: inspección + cambio de aceite anticipado

# --- Esquema de datos --------------------------------------------------------
ID_COLS = ["sample_id", "unit_id", "component", "sample_date"]

# Columnas que NUNCA pueden entrar al modelo: se escriben en el laboratorio
# después de conocer el desenlace, o son el label mismo. Ver tests/test_leakage.py.
LEAKY_COLS = [
    "lab_recommendation",   # el laboratorio la emite sabiendo cómo terminó el equipo
    "failure_date",         # fecha del evento a predecir
    "days_to_failure",      # derivada directa del label
    "label",
]

# Límites condenatorios clásicos (estilo S·O·S / CAT) para el baseline de reglas.
CONDEMNING_LIMITS = {
    "fe_ppm": 100.0,
    "cu_ppm": 40.0,
    "si_ppm": 25.0,
    "pq_index": 50.0,
    "water_pct": 0.2,
}

# --- Partición temporal ------------------------------------------------------
# Fracción del eje temporal que va a entrenamiento. El resto es validación
# estrictamente posterior: así se evalúa como en producción.
TRAIN_CUTOFF_QUANTILE = 0.70
VALID_CUTOFF_QUANTILE = 0.85  # 0.70-0.85 validación, 0.85-1.0 test final

RANDOM_SEED = 42
