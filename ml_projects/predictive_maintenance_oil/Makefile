VENV ?= .venv
PY   ?= $(VENV)/bin/python

.PHONY: help setup data train predict test all clean

help:
	@echo "setup    - crea el entorno virtual e instala dependencias"
	@echo "data     - genera el dataset sintético de la flota"
	@echo "train    - entrena, compara contra baselines y guarda el modelo"
	@echo "predict  - ranking de riesgo de la flota"
	@echo "test     - corre los tests (incluye los guardias anti-leakage)"
	@echo "all      - data + train + predict"
	@echo "clean    - borra datos generados, modelos y reportes"

setup:
	python3 -m venv $(VENV)
	$(PY) -m pip install --upgrade pip
	$(PY) -m pip install -r requirements.txt

data:
	$(PY) -m src.data.generate_synthetic

train:
	$(PY) -m src.models.train

predict:
	$(PY) -m src.models.predict

test:
	$(PY) -m pytest tests/ -q

all: data train predict

clean:
	rm -f data/raw/*.csv data/processed/*.csv models/*.joblib reports/*.csv reports/*.json
