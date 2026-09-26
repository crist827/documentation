# Diseño: app web de análisis musical y entrenamiento vocal

**Requisitos fijados**

| Decisión | Valor |
|---|---|
| Plataforma | Web (navegador), en PC y en móvil |
| Nivel del desarrollador | Intermedio (sin experiencia previa en audio/DSP) |
| Coste | Gratis: sin servidores de pago ni APIs de pago |
| Fuentes de referencia | Canciones completas, voz a cappella y MIDI/MusicXML |

La conclusión principal es que **todo el procesamiento se hace en el navegador**. Así no hay coste de servidor, los audios no salen del equipo del usuario (privacidad y derechos de autor) y la app funciona sin conexión. La única tarea que el navegador hace mal es separar la voz de una canción completa. Para eso hay dos alternativas gratuitas (sección 2.3).

---

## 1. Arquitectura general

### 1.1 Por qué web

| Criterio | Web | Escritorio | Móvil nativo |
|---|---|---|---|
| Micrófono en tiempo real | ✅ Web Audio API y AudioWorklet (latencia de 10 a 30 ms) | ✅ La mejor | ⚠️ Varía según el dispositivo |
| Distribución | ✅ Un enlace, sin instalar nada | Instalador por sistema operativo | Tiendas de apps y cuentas de desarrollador (de pago en iOS) |
| Coste | ✅ Hosting gratis (GitHub Pages o Netlify) | Gratis | Cuenta Apple: 99 USD/año |
| Librerías de pitch | ✅ JS y WASM (pitchy, Essentia.js, Basic Pitch) | Python/C++, las más completas | Limitadas |
| Curva de aprendizaje (nivel intermedio) | ✅ Un solo lenguaje (TypeScript) | Media | Alta |

Además, como PWA se puede "instalar" en el móvil y funcionar sin conexión, así que no se descarta el móvil.

### 1.2 Diagrama de módulos

```
┌──────────────────────────── NAVEGADOR ─────────────────────────────┐
│                                                                    │
│  UI (React)                                                        │
│   ├─ Afinador en vivo     ├─ Piano-roll / gráfica de pitch         │
│   ├─ Carga de canción     ├─ Informe de comparación y feedback     │
│                                                                    │
│  ──────────────────────── Núcleo de audio ─────────────────────── │
│                                                                    │
│  [Micrófono] → AudioWorklet → Detector de pitch (MPM/YIN)          │
│                                   │  f0 + claridad cada ~10 ms     │
│                                   ▼                                │
│                         Suavizado + Hz→Nota ──► UI en vivo         │
│                                   │                                │
│                                   ▼                                │
│                         Grabación del contorno del usuario         │
│                                                                    │
│  [Archivo] ─┬─ MIDI/MusicXML ─► parser ────────────────┐           │
│             ├─ a cappella ───► pYIN / CREPE ─► notas ──┤           │
│             └─ canción ──────► Melodia (Essentia.js) ──┤           │
│                  (o pista de voz separada por Demucs)  ▼           │
│                                         Secuencia de notas de ref. │
│                                                        │           │
│  Motor de comparación (latencia, octava, DTW) ◄────────┘           │
│          │                                                         │
│          ▼                                                         │
│  Métricas → Motor de feedback (reglas) → Informe                   │
│                                                                    │
│  Persistencia: IndexedDB (canciones analizadas, sesiones, progreso)│
│  Web Worker: análisis pesado de archivos sin bloquear la UI        │
└────────────────────────────────────────────────────────────────────┘
          ▲ opcional y gratis: Demucs en local o en Google Colab
```

### 1.3 Stack recomendado

| Capa | Tecnología | Motivo |
|---|---|---|
| Lenguaje y build | **TypeScript + Vite** | Tipado útil para estructuras de audio y arranque rápido |
| UI | **React** (o Svelte si lo prefieres) | Ecosistema amplio |
| Gráficas | **Canvas 2D** propio para el piano-roll; **uPlot** o Chart.js para las estadísticas | Canvas aguanta 60 fps en tiempo real |
| Pitch en vivo | **pitchy** (McLeod Pitch Method) | Ligero, preciso con la voz y con una API mínima |
| Pitch offline | **Essentia.js** (pYIN y PredominantPitchMelodia) | WASM, pensado para música. Licencia AGPL |
| Transcripción ML (opcional) | **@spotify/basic-pitch** (TF.js) o CREPE | Más robusto con ruido; más pesado |
| MIDI | **@tonejs/midi** | Convierte un .mid en una lista de notas con tiempos en segundos |
| MusicXML (opcional) | **OpenSheetMusicDisplay** | Muestra la partitura y da acceso a las notas |
| Reproducción | **Tone.js** o Web Audio nativo | Reproducción sincronizada de la canción o el MIDI |
| Persistencia | **Dexie** (IndexedDB) | Guarda sesiones y análisis en local |
| Hosting | **GitHub Pages / Netlify / Vercel** (gratis) | HTTPS incluido, obligatorio para usar el micrófono |

---

## 2. Detección de tono (pitch)

### 2.1 Comparativa de algoritmos

| Algoritmo | Tipo | Precisión en voz | Coste de CPU | Uso recomendado |
|---|---|---|---|---|
| Autocorrelación simple | Dominio del tiempo | Media, con errores de octava | Muy bajo | Solo como prototipo o para aprender |
| **YIN** | Autocorrelación mejorada | Buena | Bajo | En vivo |
| **McLeod (MPM)** | Autocorrelación normalizada | Buena y estable, con medida de "claridad" | Bajo | **En vivo (recomendado)** |
| **pYIN** | YIN probabilístico con HMM | Muy buena y suave, decide bien sonoro/sordo | Medio (necesita toda la señal) | **Archivos a cappella** |
| **Melodia** | Extracción de la melodía predominante | Aceptable sobre la mezcla completa | Medio y alto | **Canciones completas sin separar** |
| CREPE / Basic Pitch | Redes neuronales | Excelente, robusto al ruido | Alto (modelo de 5 a 20 MB) | Mejora opcional (fase 5) |

Todas estiman solo la **frecuencia fundamental (f0) de una sola voz**, es decir, son monofónicas. Por eso una canción completa necesita un paso previo: separar la voz o usar Melodia.

### 2.2 Tiempo real (micrófono)

**Configuración crítica del micrófono.** Si no se desactiva el procesado del navegador, este distorsiona el pitch:

```ts
const stream = await navigator.mediaDevices.getUserMedia({
  audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
});
```

**Parámetros recomendados**

| Parámetro | Valor | Motivo |
|---|---|---|
| Ventana de análisis | 2048 muestras (~43 ms a 48 kHz) | Resuelve bien hasta ~60 Hz (voces graves) |
| Salto (hop) | 256 a 512 muestras (5 a 10 ms) | Actualización fluida |
| Rango válido | 70 a 1100 Hz | Del bajo a la soprano; descarta ruidos fuera de ese rango |
| Umbral de claridad (MPM) | > 0,9 | Por debajo se considera silencio, consonante o ruido |
| Puerta de volumen (RMS) | > -45 dBFS aprox. | Ignora el ruido de fondo |
| Suavizado | Mediana de 5 frames | Elimina saltos de octava esporádicos |

**Versión mínima (MVP)** con `AnalyserNode` y `requestAnimationFrame`, suficiente para empezar:

```ts
import { PitchDetector } from "pitchy";

const ctx = new AudioContext();
const analyser = ctx.createAnalyser();
analyser.fftSize = 2048;
ctx.createMediaStreamSource(stream).connect(analyser);

const detector = PitchDetector.forFloat32Array(analyser.fftSize);
const buffer = new Float32Array(detector.inputLength);

function loop() {
  analyser.getFloatTimeDomainData(buffer);
  const [hz, clarity] = detector.findPitch(buffer, ctx.sampleRate);
  if (clarity > 0.9 && hz > 70 && hz < 1100) mostrarNota(hzANota(hz));
  requestAnimationFrame(loop);
}
loop();
```

Más adelante conviene pasar a un **AudioWorklet**, que ofrece un análisis a ritmo constante e independiente de la UI y una grabación exacta del contorno.

**De Hz a nota** (La4 = 440 Hz, con el Do central = Do4):

```ts
const NOMBRES = ["Do","Do#","Re","Re#","Mi","Fa","Fa#","Sol","Sol#","La","La#","Si"];

function hzANota(f: number, la4 = 440) {
  const midi = 69 + 12 * Math.log2(f / la4);   // nº de nota MIDI (con decimales)
  const n = Math.round(midi);
  return {
    nombre: `${NOMBRES[n % 12]}${Math.floor(n / 12) - 1}`, // p. ej. "Re#3"
    midi: n,
    cents: Math.round((midi - n) * 100),        // -50..+50 respecto a la nota
    hz: f,
  };
}
```

> ⚠️ En parte de la tradición hispana el Do central se llama **Do3**. Conviene que la convención de octavas y el La de referencia (440 o 442 Hz) sean configurables.

### 2.3 Archivos cargados

Todo este análisis corre en un **Web Worker** para no congelar la interfaz.

| Tipo de archivo | Pipeline | Fiabilidad |
|---|---|---|
| **MIDI** | `@tonejs/midi` → elegir la pista de la melodía (la de canal/nombre "voice" o la más aguda con menos polifonía) → notas | ⭐⭐⭐ Exacta |
| **MusicXML** | Parser/OSMD → notas con tiempos según el tempo | ⭐⭐⭐ Exacta |
| **A cappella** | Decodificar → mono a 16/22 kHz → **pYIN** (Essentia.js) → segmentar en notas | ⭐⭐⭐ Muy buena |
| **Canción completa, opción A** | **PredominantPitchMelodia** (Essentia.js) sobre la mezcla → segmentar | ⭐⭐ Aceptable; falla con coros o solos instrumentales |
| **Canción completa, opción B** | Separar la voz con **Demucs** → tratar como a cappella | ⭐⭐⭐ Muy buena |

**Demucs gratis.** Es demasiado pesado para el navegador, pero es gratis en local o en Colab:

```bash
pip install demucs
demucs --two-stems=vocals mi_cancion.mp3   # genera vocals.wav y no_vocals.wav
```

Se puede hacer lo mismo en un cuaderno de **Google Colab** (GPU gratuita). La app acepta después `vocals.wav` como referencia y `no_vocals.wav` como pista de acompañamiento para cantar encima, en modo karaoke.

**Segmentación del contorno f0 en notas** (paso común a todos los audios):

1. Convertir f0 a "semitonos MIDI continuos" y descartar los frames sin sonido.
2. Aplicar un filtro de mediana de 5 a 7 frames.
3. Abrir una nota nueva cuando el pitch se desvía más de ~70 cents de la mediana de la nota actual durante más de 50 ms, o tras un silencio.
4. Descartar las notas de menos de 80 a 100 ms (transiciones y ornamentos).
5. Asignar a cada nota su **pitch = mediana de los cents** del tramo central, sin el ataque ni la caída.

Resultado:

```ts
interface Nota { inicio: number; fin: number; midi: number; hz: number; cents: number; }
```

---

## 3. Comparación entre tu voz y la canción

### 3.1 Dos modos de práctica

| Modo | Cómo funciona | Alineación necesaria | Fase |
|---|---|---|---|
| **Sincronizado (karaoke)** | Suena la canción o el acompañamiento y cantas encima; la app graba con el mismo reloj | Solo compensar la latencia | MVP (fase 3) |
| **Libre** | Grabas tu interpretación por separado, a tu ritmo | Alineación temporal con **DTW** | Avanzada (fase 5) |

> 🎧 **Los auriculares son obligatorios en el modo karaoke.** Sin ellos el micrófono capta la canción y el detector acaba siguiendo al cantante original en vez de a ti.

### 3.2 Alineación temporal

**Latencia (modo sincronizado).** El audio de salida y el del micrófono llegan con un retraso combinado de 20 a 200 ms según el equipo. Hay dos maneras de medirlo:

- **Automática:** probar desplazamientos de -300 a +300 ms entre tu contorno y el de la referencia, y quedarse con el que minimiza el error medio en cents (una correlación cruzada simple).
- **Manual:** una prueba de calibración inicial en la que repites unos clics o "tas", y se guarda el valor.

**DTW (modo libre).** Dynamic Time Warping empareja cada instante de tu contorno con el instante equivalente de la referencia, aunque vayas más rápido o más lento.

- Entrada: dos secuencias de pitch en semitonos (normalizadas por octava, ver 3.3) muestreadas cada 10 a 20 ms.
- Coste local: `|p_usuario − p_ref|`, con una penalización fija en los silencios.
- Banda de Sakoe-Chiba (p. ej. ±2 s) para limitar el cómputo y evitar alineaciones absurdas.
- Se implementa en unas 40 líneas de TypeScript. La pendiente del camino resultante indica si vas adelantado o retrasado.

### 3.3 Octava y transposición

- **Octava:** es habitual que un hombre cante una canción de mujer una octava por debajo, y eso no debe contar como error. Se calcula la **diferencia de octava dominante** (la mediana de `round(dif/12)`) y se descuenta. Esto se puede activar o desactivar.
- **Transposición:** una opción "canto en otra tonalidad (±N semitonos)" desplaza toda la referencia.

### 3.4 Tolerancias de afinación

La diferencia se expresa en **cents** (1 semitono = 100 cents): `dif = 1200 · log2(f_usuario / f_ref)`. Es perceptualmente uniforme, a diferencia de los Hz (10 Hz de diferencia son mucho en un Do2 y poco en un Do6). La app muestra ambas unidades, pero puntúa en cents.

| Nivel | Afinado | Aceptable | Desafinado |
|---|---|---|---|
| Principiante | ≤ ±50 c | ≤ ±80 c | > 80 c |
| Intermedio (por defecto) | ≤ ±25 c | ≤ ±50 c | > 50 c |
| Avanzado | ≤ ±15 c | ≤ ±30 c | > 30 c |

### 3.5 Comparación a dos niveles

1. **Por frame (cada 10 ms):** alimenta la gráfica superpuesta (línea de referencia frente a tu línea, coloreada verde, amarillo o rojo).
2. **Por nota de referencia:** agrupa tus frames dentro de la nota (más un margen de ±150 ms para detectar entradas tempranas o tardías) y calcula:

```ts
interface ResultadoNota {
  ref: Nota;
  cantada?: { midi: number; hz: number };  // mediana de tu pitch en la nota
  desvioCents: number;        // con signo: + = alto (sostenido), − = bajo (calado)
  desvioHz: number;
  pctFramesAfinados: number;  // % de frames dentro de la tolerancia
  retrasoEntradaMs: number;   // + = entraste tarde
  diferenciaFinMs: number;    // + = soltaste tarde, − = cortaste antes
  estabilidadCents: number;   // desviación típica en la parte sostenida
  vibrato?: { hz: number; amplitudCents: number };
  estado: "afinada" | "aceptable" | "desafinada" | "omitida";
}
```

La vista principal es una **tabla o piano-roll** con cada nota: la nota esperada (Mi4), la cantada (Re#4 +30 c), la diferencia (−70 c / −19 Hz) y un color.

---

## 4. Métricas y criterios de feedback

### 4.1 Métricas

| Aspecto | Métrica | Cálculo | Buena referencia |
|---|---|---|---|
| **Afinación global** | Error absoluto medio | Media de \|desvío\| en cents, en notas no omitidas | < 25 c |
| **Tendencia** | Sesgo | Media del desvío con signo | Cerca de 0; > +15 c tiende a alto, < −15 c a bajo |
| **Precisión** | % de notas afinadas | Notas "afinadas" / total | > 80 % |
| **Estabilidad** | Desviación típica intranota | Desviación típica del pitch en el 60 % central de la nota, **sin el vibrato** | < 15 c |
| **Deriva** | Pendiente | Regresión lineal del pitch en notas largas (> 1 s), en cents/s | \|pendiente\| < 20 c/s |
| **Vibrato** | Frecuencia y amplitud | FFT del contorno sin tendencia en notas > 600 ms | 4,5–7 Hz; ±20–80 c |
| **Ataque** | Tiempo hasta afinar y "scoop" | ms desde el inicio hasta estar dentro de ±30 c; entrar desde abajo cuenta como scoop | < 100 ms |
| **Entradas** | Retraso medio y dispersión | Media y desviación típica de `retrasoEntradaMs` | \|media\| < 60 ms |
| **Salidas** | Duración relativa | Duración cantada / duración de referencia | 0,9–1,05 |
| **Intervalos** | Error en saltos | Error del intervalo cantado frente al de referencia en saltos ≥ 4 semitonos | < 30 c |
| **Registro** | Error por zona | Error medio agrupado en grave, medio y agudo | Diferencias < 15 c |

### 4.2 Motor de feedback con reglas

Es gratis y no depende de IA en la nube. Cada regla combina **condición + mensaje + ejercicio**, y se muestran como máximo las **3 de más impacto**, ordenadas por gravedad, para no abrumar.

| Condición | Mensaje | Ejercicio sugerido |
|---|---|---|
| Sesgo < −15 c | "Tiendes a cantar **bajo (calado)**, sobre todo en el agudo." | Escalas ascendentes con apoyo respiratorio; pensar la nota "por encima" |
| Sesgo > +15 c | "Tiendes a cantar **alto (sostenido)**." | Relajar la tensión laríngea; notas largas a volumen medio |
| Estabilidad > 25 c | "Tus notas largas **oscilan**." | Notas tenidas de 8 s con el afinador en pantalla |
| Deriva < −20 c/s | "Las notas largas **se caen** al final." | Control del aire: messa di voce |
| Scoop en > 40 % de las notas | "Entras en las notas **desde abajo**." | Ataques limpios en staccato |
| Retraso medio > +80 ms | "Entras **tarde** de forma sistemática." | Practicar con metrónomo; respirar antes |
| Duración < 0,85 | "**Cortas** las notas antes de tiempo." | Sostener hasta el final de la frase |
| Error en saltos > 2× el error en grados conjuntos | "Los **saltos grandes** te cuestan." | Ejercicios de intervalos (3ª, 5ª, 8ª) |
| Error en el agudo > 2× el error en el medio | "Pierdes precisión en el **registro agudo**." | Trabajar el paso de registro; transponer −2 semitonos |

La **puntuación global** (0–100) es una media ponderada, por ejemplo: 50 % afinación, 20 % estabilidad, 20 % ritmo y 10 % ataques. Se guarda por sesión en IndexedDB para mostrar la evolución.

---

## 5. Estructura del proyecto

```
src/
├─ audio/
│  ├─ mic.ts               // getUserMedia + AudioContext
│  ├─ pitch-worklet.ts     // AudioWorklet (fase 2+)
│  ├─ detector.ts          // pitchy + suavizado + puerta
│  └─ notas.ts             // hzANota, cents, convención de octavas
├─ analisis/               // se ejecuta en un Web Worker
│  ├─ decodificar.ts
│  ├─ midi.ts              // @tonejs/midi → Nota[]
│  ├─ contorno.ts          // pYIN / Melodia (Essentia.js)
│  └─ segmentar.ts         // contorno → Nota[]
├─ comparacion/
│  ├─ latencia.ts
│  ├─ octava.ts
│  ├─ dtw.ts
│  └─ comparar.ts          // → ResultadoNota[]
├─ feedback/
│  ├─ metricas.ts
│  └─ reglas.ts
├─ ui/                     // Afinador, PianoRoll, Informe, Historial
└─ db.ts                   // Dexie
```

Las carpetas `analisis/`, `comparacion/` y `feedback/` son **TypeScript puro sin DOM**, así que se pueden probar con **Vitest** usando audios sintéticos (senoidales a frecuencias conocidas).

---

## 6. Plan de desarrollo por fases

| Fase | Objetivo | Entregables | Duración orientativa* |
|---|---|---|---|
| **0. Base** | Proyecto listo | Vite + React + TS, despliegue en GitHub Pages (HTTPS), Vitest | 2–3 días |
| **1. Afinador (MVP 1)** | Función 1 | Micrófono, nota en vivo (Re#3), aguja de cents, gráfica de pitch de los últimos 10 s | 1–2 semanas |
| **2. Referencias simples** | Función 2 (parte fácil) | Carga de MIDI y a cappella, pYIN y segmentación, piano-roll, reproducción | 2–3 semanas |
| **3. Comparación sincronizada (MVP 2)** | Función 3 | Modo karaoke, compensación de latencia, octava automática, tabla por nota (cents y Hz), gráfica superpuesta | 2–3 semanas |
| **4. Feedback** | Función 4 | Métricas, motor de reglas, puntuación, historial en IndexedDB y gráfica de progreso | 2 semanas |
| **5. Avanzado** | Completar | Canciones completas (Melodia y flujo con Demucs), modo libre con DTW, transposición, practicar un fragmento en bucle, PWA offline, exportar el informe a PDF | 4+ semanas |
| **6. Extras (opcionales)** | Pulido | CREPE/Basic Pitch para más precisión, detección de vibrato en vivo, ejercicios guiados (escalas generadas), modo a dos voces | — |

\* Para una persona de nivel intermedio con dedicación parcial.

**Criterio para cerrar cada fase:** probarla con 3 casos reales (una voz grave, una aguda y un audio ruidoso) antes de pasar a la siguiente.

---

## 7. Riesgos y cómo mitigarlos

| Riesgo | Mitigación |
|---|---|
| El micrófono capta la canción | Auriculares obligatorios y aviso en la UI |
| Errores de octava del detector | Umbral de claridad, filtro de mediana y restricción del rango vocal del usuario |
| Latencia distinta en cada equipo | Calibración automática por correlación y un ajuste manual |
| Melodía mal extraída en canciones con mucha instrumentación | Ofrecer Demucs o permitir cargar un MIDI de referencia |
| Consonantes y respiraciones se leen como notas | Puerta de volumen y claridad; ignorar segmentos < 80 ms |
| Diferencias entre navegadores (Safari en iOS) | Probar pronto en iOS y pedir el micrófono tras un gesto del usuario |
| Derechos de autor | Todo se procesa en local; la app no sube ni distribuye canciones |
| Licencia AGPL de Essentia.js | Aceptable en un proyecto personal o de código abierto; si la app se vuelve comercial, usar pYIN propio o Basic Pitch (Apache 2.0) |
