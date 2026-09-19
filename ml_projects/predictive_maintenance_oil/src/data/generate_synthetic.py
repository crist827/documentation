"""Genera un dataset sintético de análisis de aceite de flota, estilo S·O·S / CAT.

Por qué sintético: los datos de laboratorio de una flota real son confidenciales y
suelen estar en PDFs. Este simulador reproduce la física del problema —desgaste
acumulado, cambios de aceite que resetean los metales, modos de falla con firmas
distintas, y fallas súbitas sin precursor— para que el pipeline de ML sea
trasladable tal cual a datos reales con solo cambiar el loader.

Decisión de diseño importante: un 25% de las fallas es súbito, sin rampa previa en
el aceite. Eso pone un techo realista al recall alcanzable. Un dataset donde el
modelo llega a 0.99 de AUC es un dataset que miente.

Uso:
    python -m src.data.generate_synthetic --units 120 --years 3
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from src.config import DATA_RAW, HORIZON_DAYS, RANDOM_SEED

# --- Catálogo de componentes -------------------------------------------------
# Cada componente tiene su propia dinámica: el motor cambia aceite cada ~500 h y
# genera hollín; el hidráulico dura miles de horas y es sensible a la suciedad.


@dataclass(frozen=True)
class ComponentSpec:
    name: str
    oil_change_hours: float
    sample_interval_hours: float
    visc_grade: float          # viscosidad nominal @100 °C (cSt)
    tbn_new: float             # TBN de aceite nuevo (mgKOH/g)
    wear_rates: dict           # ppm por cada 1000 h de aceite, en condición normal
    failure_rate_per_year: float


COMPONENTS: tuple[ComponentSpec, ...] = (
    ComponentSpec(
        name="engine",
        oil_change_hours=500,
        sample_interval_hours=250,
        visc_grade=14.5,
        tbn_new=11.0,
        wear_rates={"fe": 22, "cu": 6, "cr": 3, "pb": 4, "al": 5, "si": 8, "na": 3, "k": 2, "sn": 1.5},
        failure_rate_per_year=0.16,
    ),
    ComponentSpec(
        name="transmission",
        oil_change_hours=1000,
        sample_interval_hours=500,
        visc_grade=10.5,
        tbn_new=7.0,
        wear_rates={"fe": 30, "cu": 10, "cr": 2, "pb": 3, "al": 3, "si": 6, "na": 2, "k": 1, "sn": 2},
        failure_rate_per_year=0.11,
    ),
    ComponentSpec(
        name="hydraulic",
        oil_change_hours=2000,
        sample_interval_hours=500,
        visc_grade=9.0,
        tbn_new=2.0,
        wear_rates={"fe": 12, "cu": 4, "cr": 1, "pb": 1.5, "al": 2, "si": 10, "na": 2, "k": 1, "sn": 0.8},
        failure_rate_per_year=0.08,
    ),
    ComponentSpec(
        name="final_drive",
        oil_change_hours=2000,
        sample_interval_hours=1000,
        visc_grade=17.0,
        tbn_new=1.5,
        wear_rates={"fe": 45, "cu": 8, "cr": 4, "pb": 5, "al": 2, "si": 7, "na": 1, "k": 1, "sn": 1},
        failure_rate_per_year=0.09,
    ),
)

EQUIPMENT_MODELS = ("CAT 336", "CAT 349", "CAT 966", "CAT 777", "CAT 992", "CAT C32 GENSET")

# --- Modos de falla ----------------------------------------------------------
# Cada modo multiplica ciertos analitos. Esa es la "firma" que el modelo debe
# aprender a separar del ruido de operación.

FAILURE_MODES = {
    # Desgaste abrasivo: entra tierra (silicio) y lima hierro y cromo.
    "abrasive": {"si": 9.0, "fe": 6.0, "cr": 5.0, "al": 3.0, "pq": 3.0},
    # Falla de rodamiento / cojinete: plomo, cobre y estaño, con PQ alto
    # porque se desprenden partículas ferrosas grandes.
    "bearing": {"pb": 12.0, "cu": 8.0, "sn": 7.0, "fe": 3.5, "pq": 9.0},
    # Entrada de refrigerante: sodio, potasio y agua.
    "coolant": {"na": 15.0, "k": 12.0, "water": 10.0, "fe": 2.5, "pq": 2.0},
    # Dilución por combustible: baja la viscosidad, sube el desgaste general.
    "fuel_dilution": {"fuel": 12.0, "fe": 2.5, "cu": 2.0, "pq": 1.5},
    # Sobrecarga térmica / hollín: sube hollín y viscosidad, cae el TBN.
    "soot_overload": {"soot": 8.0, "fe": 3.0, "pq": 2.5},
}

MODE_NAMES = tuple(FAILURE_MODES)


@dataclass
class _Fault:
    """Una falla en progresión dentro de un componente."""

    mode: str
    start_day: float
    failure_day: float
    sudden: bool
    peak_severity: float = 1.0

    def severity(self, day: float) -> float:
        """Severidad en [0, 1]. Crece de forma convexa hasta la falla.

        Una falla súbita no deja rastro en el aceite: severidad 0 siempre.
        """
        if self.sudden or day < self.start_day:
            return 0.0
        span = max(self.failure_day - self.start_day, 1e-6)
        progress = min((day - self.start_day) / span, 1.0)
        return self.peak_severity * progress ** 2.2


@dataclass
class _Unit:
    unit_id: str
    model: str
    spec: ComponentSpec
    hours_per_day: float
    quality: float                     # multiplicador de desgaste propio del equipo
    dust_exposure: float               # qué tan sucio es su sitio de trabajo
    faults: list = field(default_factory=list)


def _new_fault(rng: np.random.Generator, day: float, spec: ComponentSpec, horizon_days: float) -> _Fault:
    """Programa una falla futura, con o sin precursor tribológico."""
    sudden = rng.random() < 0.25
    # Una falla progresiva se incuba entre 45 y 200 días.
    incubation = rng.uniform(45, 200)
    failure_day = min(day + incubation, horizon_days + 400)
    return _Fault(
        mode=str(rng.choice(MODE_NAMES)),
        start_day=day,
        failure_day=failure_day,
        sudden=sudden,
        peak_severity=rng.uniform(0.6, 1.4),
    )


def _measure(
    rng: np.random.Generator,
    unit: _Unit,
    oil_hours: float,
    day: float,
) -> dict:
    """Devuelve la lectura de laboratorio de una muestra."""
    spec = unit.spec
    khours = oil_hours / 1000.0

    # Severidad agregada de las fallas activas y su firma.
    boost: dict[str, float] = {}
    severity_total = 0.0
    for fault in unit.faults:
        sev = fault.severity(day)
        if sev <= 0:
            continue
        severity_total += sev
        for analyte, gain in FAILURE_MODES[fault.mode].items():
            boost[analyte] = boost.get(analyte, 0.0) + gain * sev

    def wear(metal: str) -> float:
        """ppm de un metal: desgaste normal acumulado + aporte de la falla + ruido."""
        base = spec.wear_rates[metal] * khours * unit.quality
        if metal == "si":
            base *= unit.dust_exposure
        extra = boost.get(metal, 0.0) * spec.wear_rates[metal] * max(khours, 0.25)
        value = base + extra
        # Ruido multiplicativo: el laboratorio tiene repetibilidad limitada.
        value *= rng.lognormal(mean=0.0, sigma=0.18)
        return max(value + rng.normal(0, 0.6), 0.0)

    fe = wear("fe")
    si = wear("si")

    # El silicio actúa como abrasivo: ensucia el hierro incluso sin falla declarada.
    fe += 0.35 * max(si - 15.0, 0.0) * rng.uniform(0.6, 1.4)

    # Índice PQ: partículas ferrosas grandes. Correlaciona con Fe pero no es lineal;
    # sube de golpe cuando hay desprendimiento de material.
    pq = 0.22 * fe + boost.get("pq", 0.0) * 4.5 + rng.normal(0, 2.0)

    water = 0.02 + boost.get("water", 0.0) * 0.02 + max(rng.normal(0, 0.012), 0)
    fuel = 0.4 + boost.get("fuel", 0.0) * 0.35 + max(rng.normal(0, 0.25), 0)
    soot = (0.25 * khours + boost.get("soot", 0.0) * 0.30) if spec.name == "engine" else 0.0
    soot = max(soot + rng.normal(0, 0.08), 0.0)

    # TBN cae con las horas de aceite y se acelera con hollín y sobrecarga.
    tbn = spec.tbn_new * np.exp(-0.55 * khours - 0.05 * severity_total) + rng.normal(0, 0.15)

    # Viscosidad: el hollín la sube, el combustible la baja.
    visc = spec.visc_grade * (1 + 0.020 * soot - 0.030 * fuel) + rng.normal(0, 0.25)

    oxidation = 8.0 + 14.0 * khours + 3.0 * severity_total + rng.normal(0, 1.2)

    return {
        "fe_ppm": round(fe, 1),
        "cu_ppm": round(wear("cu"), 1),
        "cr_ppm": round(wear("cr"), 1),
        "pb_ppm": round(wear("pb"), 1),
        "al_ppm": round(wear("al"), 1),
        "sn_ppm": round(wear("sn"), 1),
        "si_ppm": round(si, 1),
        "na_ppm": round(wear("na"), 1),
        "k_ppm": round(wear("k"), 1),
        "pq_index": round(max(pq, 0.0), 1),
        "water_pct": round(max(water, 0.0), 3),
        "fuel_pct": round(max(fuel, 0.0), 2),
        "soot_pct": round(soot, 2),
        "tbn": round(max(tbn, 0.05), 2),
        "visc_100c": round(max(visc, 1.0), 2),
        "oxidation_abs": round(max(oxidation, 0.0), 1),
    }


def generate(n_units: int = 400, years: float = 3.0, seed: int = RANDOM_SEED) -> pd.DataFrame:
    """Simula la flota completa y devuelve el registro de muestras."""
    rng = np.random.default_rng(seed)
    horizon_days = years * 365.0
    start = pd.Timestamp("2022-01-01")

    rows: list[dict] = []
    failures: list[dict] = []
    sample_counter = 0

    for i in range(n_units):
        model = str(rng.choice(EQUIPMENT_MODELS))
        # Cada equipo aporta entre 1 y 3 componentes monitoreados.
        specs = rng.choice(
            np.array(COMPONENTS, dtype=object),
            size=int(rng.integers(1, 4)),
            replace=False,
        )
        for spec in specs:
            unit = _Unit(
                unit_id=f"U{i:03d}",
                model=model,
                spec=spec,
                hours_per_day=float(rng.uniform(6, 18)),
                quality=float(rng.lognormal(0.0, 0.22)),
                dust_exposure=float(rng.lognormal(0.0, 0.35)),
            )

            day = float(rng.uniform(0, 30))          # arranque escalonado del monitoreo
            unit_hours = float(rng.uniform(500, 12000))
            oil_hours = float(rng.uniform(0, spec.oil_change_hours * 0.8))
            # Probabilidad diaria de que se incube una falla nueva.
            p_fault_day = spec.failure_rate_per_year / 365.0

            while day < horizon_days:
                step_hours = spec.sample_interval_hours * float(rng.uniform(0.75, 1.25))
                step_days = step_hours / unit.hours_per_day
                day += step_days
                unit_hours += step_hours
                oil_hours += step_hours

                if day >= horizon_days:
                    break

                # ¿Se incuba una falla nueva en este intervalo?
                if not unit.faults and rng.random() < p_fault_day * step_days:
                    unit.faults.append(_new_fault(rng, day, spec, horizon_days))

                reading = _measure(rng, unit, oil_hours, day)
                sample_date = start + pd.Timedelta(days=day)
                sample_counter += 1

                rows.append(
                    {
                        "sample_id": f"S{sample_counter:06d}",
                        "unit_id": unit.unit_id,
                        "equipment_model": model,
                        "component": spec.name,
                        "sample_date": sample_date,
                        "unit_hours": round(unit_hours, 1),
                        "oil_hours": round(oil_hours, 1),
                        "oil_changed": False,
                        **reading,
                    }
                )

                # Cambio de aceite: resetea horas de aceite y arrastra solo un
                # residual de los metales (el sistema no queda perfectamente limpio).
                if oil_hours >= spec.oil_change_hours * float(rng.uniform(0.9, 1.15)):
                    oil_hours = float(rng.uniform(0, 20))
                    rows[-1]["oil_changed"] = True

                # ¿Llegó el día de la falla?
                active = [f for f in unit.faults if day >= f.failure_day]
                if active:
                    fault = active[0]
                    failures.append(
                        {
                            "unit_id": unit.unit_id,
                            "component": spec.name,
                            "failure_date": start + pd.Timedelta(days=fault.failure_day),
                            "failure_mode": fault.mode if not fault.sudden else "sudden",
                        }
                    )
                    # Reparación: componente nuevo, aceite nuevo, sin falla activa.
                    unit.faults.clear()
                    oil_hours = 0.0
                    # Un componente reparado puede volver a fallar más adelante.

    df = pd.DataFrame(rows)
    failures_df = pd.DataFrame(failures)
    return _attach_labels(df, failures_df)


def _attach_labels(df: pd.DataFrame, failures: pd.DataFrame) -> pd.DataFrame:
    """Marca cada muestra con la próxima falla de su componente.

    `merge_asof` con dirección "forward" busca, para cada muestra, el primer evento
    de falla POSTERIOR del mismo unit_id+component. El label se deriva después,
    aplicando el horizonte. Así cambiar HORIZON_DAYS no obliga a regenerar datos.
    """

    df = df.sort_values("sample_date").reset_index(drop=True)

    if failures.empty:
        df["failure_date"] = pd.NaT
    else:
        failures = failures.sort_values("failure_date").reset_index(drop=True)
        df = pd.merge_asof(
            df,
            failures[["unit_id", "component", "failure_date"]],
            left_on="sample_date",
            right_on="failure_date",
            by=["unit_id", "component"],
            direction="forward",
            allow_exact_matches=False,
        )

    df["days_to_failure"] = (df["failure_date"] - df["sample_date"]).dt.days
    df["label"] = (df["days_to_failure"].notna() & (df["days_to_failure"] <= HORIZON_DAYS)).astype(int)

    # Columna deliberadamente contaminada: el laboratorio la escribe sabiendo el
    # desenlace. Existe para demostrar el guardia anti-leakage, no para usarla.
    df["lab_recommendation"] = np.where(
        df["label"] == 1, "REBUILD / PARAR EQUIPO", "CONTINUAR MONITOREO"
    )
    return df


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--units", type=int, default=400)
    parser.add_argument("--years", type=float, default=3.0)
    parser.add_argument("--seed", type=int, default=RANDOM_SEED)
    args = parser.parse_args()

    df = generate(n_units=args.units, years=args.years, seed=args.seed)
    DATA_RAW.mkdir(parents=True, exist_ok=True)
    out = DATA_RAW / "oil_samples.csv"
    df.to_csv(out, index=False)

    pos = int(df["label"].sum())
    print(f"Muestras generadas : {len(df):,}")
    print(f"Componentes         : {df.groupby(['unit_id', 'component']).ngroups:,}")
    print(f"Rango temporal      : {df.sample_date.min():%Y-%m-%d} a {df.sample_date.max():%Y-%m-%d}")
    print(f"Positivos (falla<={HORIZON_DAYS}d): {pos:,} ({pos / len(df):.2%})")
    print(f"Escrito en          : {out}")


if __name__ == "__main__":
    main()
