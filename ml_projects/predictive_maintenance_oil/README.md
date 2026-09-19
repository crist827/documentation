# Mantenimiento predictivo con análisis de aceite

Predecir si un componente de maquinaria pesada va a fallar **dentro de los
próximos 30 días**, usando únicamente los resultados de laboratorio del aceite
(estilo S·O·S / CAT): metales de desgaste en ppm, índice PQ, TBN, viscosidad,
contaminantes.

El entregable no es un número de accuracy: es un **ranking semanal de los
componentes más riesgosos de la flota**, con el modo de falla probable, para que
mantenimiento decida a quién inspecciona con la capacidad que tiene.

---

## 1. El problema, planteado como decisión

Mal planteado: *"predecir fallas de motor"*.
Bien planteado: *"el equipo puede inspeccionar el 10% de la flota por semana —
¿cuáles 10%?"*

Ese encuadre fija todo lo demás:

| Decisión | Valor | Por qué |
|---|---|---|
| Horizonte | 30 días | Alcanza para programar la intervención en una parada planificada; más largo diluye la señal tribológica |
| Unidad de predicción | muestra de aceite (unit_id + componente + fecha) | Es el momento en que existe información nueva y se puede decidir |
| Métrica principal | **PR-AUC** y **recall@10%** | Con 0.95% de positivos, el accuracy premia al que nunca alerta |
| Métrica de negocio | costo esperado | USD 25.000 por falla no programada vs. USD 800 por inspección |

## 2. Los datos

`src/data/generate_synthetic.py` simula una flota porque los datos reales de
laboratorio son confidenciales y viven en PDFs. La simulación no es ruido
aleatorio: reproduce la física del problema.

- **400 equipos**, 798 componentes monitoreados (motor, transmisión, hidráulico,
  mando final), 3 años, **22.983 muestras**.
- Desgaste acumulado proporcional a las horas de aceite, con multiplicador propio
  por equipo (hay máquinas malas) y por sitio (hay obras con más tierra).
- **Los cambios de aceite resetean los metales.** Esta es la trampa número uno
  del dominio y está simulada explícitamente.
- **Cinco modos de falla con firmas distintas**: abrasivo (Si→Fe,Cr), rodamiento
  (Pb,Cu,Sn,PQ), refrigerante (Na,K,agua), dilución por combustible (viscosidad↓),
  sobrecarga térmica (hollín↑, TBN↓).
- **El 25% de las fallas es súbito, sin precursor en el aceite.** Es deliberado:
  pone un techo realista al recall. Un dataset donde el modelo llega a 0.99 de
  AUC es un dataset que miente.

Resultado: **219 positivos sobre 22.983 muestras (0.95%)**. Desbalance real.

Para usar datos reales solo hay que reescribir `src/data/load.py`. El resto del
pipeline no se entera.

## 3. Features: el nivel miente, la tasa informa

147 features, agrupadas en seis bloques (`src/features/build_features.py`):

1. **Analitos crudos** — los 16 valores del reporte de laboratorio.
2. **Tasas normalizadas por edad del aceite** — `fe_ppm_per100h` y similares.
   *80 ppm de hierro con 40 h de aceite es una emergencia; los mismos 80 ppm con
   480 h es rutina.* Sin esta normalización el problema es casi irresoluble.
3. **Deltas y tasas de cambio** respecto de la muestra anterior — **anulados
   (NaN) cuando cruzan un cambio de aceite**, porque comparan cosas distintas.
4. **Ventanas móviles** (3 y 5 muestras): media, desvío, máximo y un *z-score
   local* que mide cuánto se despega la muestra actual de su propia historia.
5. **Posición relativa a la flota** — ratio contra la mediana de su tipo de
   componente. La referencia se ajusta **solo con datos de entrenamiento**.
6. **Límites condenatorios** — las reglas del laboratorio como features. Codifican
   décadas de experiencia que el modelo no tiene por qué redescubrir.

## 4. Validación: el detalle que define si el número sirve

**Partición estrictamente temporal**, 70/15/15 sobre el eje de tiempo:

```
train  2022-01-16 → 2024-02-16   16.088 muestras   147 positivos
valid  2024-02-16 → 2024-07-24    3.447 muestras    42 positivos
test   2024-07-24 → 2024-12-30    3.448 muestras    30 positivos
```

Un `train_test_split` aleatorio pondría la muestra de marzo en train y la de
febrero del **mismo componente** en test. El modelo vería el futuro y el número
saldría inflado sin reproducirse jamás en producción. En mantenimiento predictivo
esta es *la* fuente de error.

Dos sutilezas más, ambas implementadas:

- **Las features se calculan sobre la serie completa y recién después se corta.**
  Parece leakage pero no lo es: todas las ventanas miran hacia atrás. Transformar
  cada split por separado sí sería un error — las primeras muestras de validación
  perderían el historial que en producción sí existe.
- **El umbral de decisión se elige en validación y se aplica tal cual en test.**
  Elegirlo en test es otra forma de hacer trampa.

## 5. Resultados

Los baselines no son decorativos: `tasa_hierro_100h` es lo que hace un analista
con experiencia, y **casi empata al modelo**. Ese es el número honesto a reportar.

**Conjunto de test** (3.448 muestras, 30 fallas, tasa base 0.87%):

| Modelo | PR-AUC | ROC-AUC | Precisión@10% | Recall@10% | Lift |
|---|---|---|---|---|---|
| Aleatorio | 0.014 | 0.552 | 0.012 | 0.133 | 1.3× |
| Límites condenatorios (lo que se usa hoy) | 0.034 | 0.760 | 0.035 | 0.400 | 4.0× |
| Tasa de hierro por 100 h | 0.098 | 0.724 | 0.052 | 0.600 | 6.0× |
| **Gradient boosting** | **0.282** | 0.793 | 0.058 | **0.667** | **6.7×** |

**Lectura honesta del resultado:**

- El modelo **triplica el PR-AUC** del mejor baseline y detecta **2 de cada 3
  fallas** inspeccionando solo el 10% de la flota — 6,7 veces mejor que el azar.
- Frente a los **límites condenatorios que el laboratorio usa hoy**, el recall
  sube de 0.40 a 0.67: **dos tercios más de fallas detectadas con el mismo
  esfuerzo de inspección**. Ese es el argumento de negocio.
- La precisión@10% es baja (0.058) y **eso es esperable**: con una tasa base de
  0.87%, inspeccionar 345 componentes para encontrar 20 fallas sigue siendo
  rentable cuando la falla cuesta 30 veces más que la inspección.
- El techo lo pone el 25% de fallas súbitas, que por construcción no dejan rastro
  en el aceite. Ningún modelo sobre estos datos puede superarlo.

**Traducción a dinero** (umbral elegido en validación, aplicado en test):

| Escenario | Costo en el período de test |
|---|---|
| Sin programa de monitoreo | USD 750.000 |
| Con el modelo | USD 377.000 |
| **Ahorro** | **USD 373.000 (49,7%)** |

**Features más importantes** (importancia por permutación, medida en validación):

```
pq_index_vs_fleet      0.1006   índice PQ contra la mediana de su componente
pq_index_per100h       0.0465   tasa de partículas ferrosas por 100 h de aceite
cu_ppm_roll3_max       0.0127   pico de cobre en las últimas 3 muestras
al_ppm_rate100h        0.0111   aceleración del aluminio
pq_index_delta         0.0090   salto de PQ respecto de la muestra anterior
```

El modelo aprendió tribología: **PQ normalizado y comparado contra la flota**
domina, que es exactamente lo que miraría un analista. Los niveles crudos quedan
muy abajo — la señal está en la tendencia y en el contexto, no en el valor.

## 6. Cómo correrlo

```bash
make setup      # entorno virtual + dependencias
make all        # genera datos, entrena y produce el ranking
make test       # 10 tests, incluidos los guardias anti-leakage
```

Salida de `make predict`:

```
unit_id    component sample_date  risk_score                                    diagnostico  fe_ppm  pq_index
   U303 transmission  2024-11-26       0.810  desgaste abrasivo (ingreso de tierra) (×8.7)   229.6      65.6
   U142 transmission  2024-11-28       0.794  desgaste abrasivo (ingreso de tierra) (×11.0)  316.4      87.5
   U374 transmission  2024-11-26       0.752  ingreso de refrigerante (×7.5 vs. flota)        48.8      19.4
```

Un score sin explicación no lo acciona nadie: el planificador necesita saber si
va a buscar un rodamiento o una entrada de tierra.

Servicio HTTP opcional:

```bash
pip install fastapi uvicorn
uvicorn src.api.main:app --reload
```

## 7. Los tests son el proyecto

`tests/test_leakage.py` contiene la prueba más importante del repo:

```python
def test_las_features_no_miran_el_futuro(raw_df):
    """Perturbar el futuro no debe alterar las features del pasado."""
```

Corrompe las últimas 3 muestras de cada componente con valores absurdos,
recalcula todo y exige que **las filas anteriores salgan idénticas**. Es la
prueba directa —y la más difícil de engañar— de ausencia de leakage temporal.
Si pasa, el número de la sección 5 significa algo.

Los otros nueve verifican invariantes del dominio: que los deltas no crucen
cambios de aceite, que las ventanas móviles incluyan la muestra actual, que la
referencia de flota se ajuste solo con train, que el label respete el horizonte.

## 8. Limitaciones

- **Datos sintéticos.** Las relaciones son plausibles pero las inventé yo. Sobre
  datos reales hay ruido de laboratorio, muestras mal etiquetadas, componentes
  cambiados sin registrar y fechas de falla imprecisas.
- **El label depende de un registro de fallas confiable**, que es justo lo que
  peor se mantiene en la mayoría de las flotas. En un proyecto real, construir y
  auditar ese registro es la mitad del trabajo.
- **Sin calibración de probabilidades.** El ranking es correcto pero el 0.81 no
  es literalmente "81% de probabilidad de falla". Para decisiones por umbral fino
  hace falta calibración isotónica sobre validación.
- **Un solo horizonte.** Un sistema productivo querría 30/60/90 días en paralelo.
- **Sin detección de drift.** Un cambio de proveedor de aceite o de laboratorio
  corre las distribuciones y degrada el modelo en silencio.

## 9. Próximos pasos

1. Calibración isotónica y intervalos de confianza por predicción.
2. Modelo de supervivencia (Cox o *gradient boosted survival*) en vez de
   clasificación binaria: aprovecha las muestras censuradas y estima *cuándo*.
3. SHAP por muestra, reemplazando el diagnóstico por reglas de `predict.py`.
4. Monitoreo de drift sobre las distribuciones de entrada.
5. Reentrenamiento incremental con ventana deslizante de 24 meses.

## 10. Estructura

```
├── src/
│   ├── config.py                    horizonte, costos, límites, cortes temporales
│   ├── data/
│   │   ├── generate_synthetic.py    simulador de flota con modos de falla
│   │   └── load.py                  carga y partición temporal
│   ├── features/build_features.py   FeatureBuilder (fit en train, transform en todo)
│   ├── models/
│   │   ├── baselines.py             azar, límites condenatorios, tasa de hierro
│   │   ├── train.py                 entrenamiento, comparación y umbral por costo
│   │   └── predict.py               ranking de flota con diagnóstico
│   ├── evaluation/metrics.py        PR-AUC, precisión/recall@k, lift, costo
│   └── api/main.py                  servicio FastAPI
├── tests/                           guardias anti-leakage e invariantes de dominio
├── reports/                         métricas, importancias y ranking generados
└── Makefile
```
