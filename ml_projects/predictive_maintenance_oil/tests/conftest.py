import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.data.generate_synthetic import generate  # noqa: E402


@pytest.fixture(scope="session")
def raw_df():
    """Flota chica y rápida, suficiente para los invariantes del pipeline."""
    return generate(n_units=40, years=2.0, seed=7)
