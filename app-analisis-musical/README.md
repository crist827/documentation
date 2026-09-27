# Entrenador Vocal

App web para practicar canto: afinador en tiempo real, análisis de las notas de una canción, comparación entre tu voz y la canción, y consejos de mejora. Todo se procesa **en tu navegador**: no hay servidor, tus audios no salen de tu equipo y es gratis. El diseño completo está en [DISENO.md](./DISENO.md).

## Uso

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # tests unitarios (Vitest)
npm run build      # genera dist/ para publicar
```

El navegador solo permite usar el micrófono en `localhost` o con HTTPS. Para publicarla gratis, sube el contenido de `dist/` a GitHub Pages, Netlify o Vercel. Las rutas son relativas (`base: "./"`), así que funciona en cualquier subcarpeta.

## Pestañas

| Pestaña | Qué hace |
|---|---|
| **Afinador** | Muestra la nota que cantas (p. ej. `Re#3`), su frecuencia, una aguja de ±50 cents y la gráfica de los últimos 10 s |
| **Canción** | Carga un MIDI, un audio a cappella o una canción completa, detecta la melodía y la muestra en un piano-roll. Las canciones quedan guardadas en el navegador |
| **Practicar** | *Sincronizado*: cantas mientras suena la referencia. *Libre*: cantas a tu ritmo y la app alinea tu interpretación con DTW. Permite practicar un fragmento, añadir una pista de acompañamiento y hacer una cuenta atrás |
| **Informe** | Puntuación de 0 a 100 con desglose, consejos con ejercicios, métricas, gráfica de tu voz frente a la referencia y tabla nota a nota (±cents / ±Hz, entrada en ms) |
| **Progreso** | Historial de sesiones y evolución de la puntuación |
| **⚙ Ajustes** | Nivel de exigencia, corrección de octava, transposición, convención de octavas (Do central = Do4 o Do3), La de referencia y latencia manual |

**Consejos:**
- Usa **auriculares** en el modo sincronizado. Sin ellos, el micrófono capta la canción.
- Para **canciones completas**, la detección es mucho mejor si separas antes la voz con [Demucs](https://github.com/facebookresearch/demucs):
  ```bash
  pip install demucs
  demucs --two-stems=vocals cancion.mp3
  ```
  Después carga `vocals.wav` como *a cappella*, y `no_vocals.wav` como acompañamiento en Practicar.

## Estructura

```
src/
├─ tipos.ts, notas.ts     contratos compartidos y conversión Hz ↔ nota
├─ audio/                 micrófono, detector McLeod (pitchy), AudioWorklet, afinador
├─ analisis/              MIDI → melodía, YIN offline, segmentación en notas (Web Worker)
├─ comparacion/           latencia, octava, DTW y análisis por nota
├─ feedback/              métricas, vibrato, reglas de consejos y puntuación
├─ referencia/            reproducción (audio o síntesis del MIDI) y fragmentos
├─ ui/                    vistas React y piano-roll en canvas
└─ db.ts, ajustes.ts      IndexedDB (Dexie) y ajustes en localStorage
```

## Estado

Implementadas las fases 0 a 4 de DISENO.md, más el modo libre con DTW, la transposición y la práctica por fragmentos de la fase 5.

Pendiente:
- Melodia/Demucs dentro del navegador. Por ahora las canciones completas se analizan con YIN y parámetros más estrictos.
- PWA offline.
- Exportar el informe a PDF.
- Modelos de IA (CREPE, Basic Pitch).
