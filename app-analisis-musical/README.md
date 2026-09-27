# Entrenador Vocal

App web para practicar canto: afinador en tiempo real, análisis de las notas de una canción, comparación entre tu voz y la canción, y consejos de mejora. Todo se procesa **en tu navegador**: no hay servidor, tus audios no salen de tu equipo y es gratis. El diseño completo está en [DISENO.md](./DISENO.md).

## Uso

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # tests unitarios (Vitest)
npm run build      # genera dist/ para publicar
```

### Usarla en el computador sin instalar nada

```bash
npm run build:archivo   # genera dist-archivo/index.html
```

Genera **un solo archivo HTML** con todo dentro. Se abre con doble clic (Chrome, Edge o Firefox) y funciona sin servidor ni conexión. No hay que abrir el `index.html` de `dist/`, porque el navegador bloquea esa versión cuando se abre como archivo.

### Publicarla

El navegador solo permite usar el micrófono en `localhost` o con HTTPS. Para publicarla gratis, sube el contenido de `dist/` a GitHub Pages, Netlify o Vercel. Las rutas son relativas (`base: "./"`), así que funciona en cualquier subcarpeta.

## Usarla en el celular

La app funciona en el navegador del móvil (Chrome en Android, Safari en iPhone) y se puede **instalar como una app**. Lo único imprescindible es que esté publicada con **HTTPS**: sin HTTPS el celular no deja usar el micrófono.

1. **Publicarla gratis.** Aunque el repositorio sea privado, se puede publicar gratis en [Netlify](https://app.netlify.com/start), [Vercel](https://vercel.com/new) o [Cloudflare Pages](https://pages.cloudflare.com):
   - Entra con tu cuenta de GitHub, elige "importar proyecto" y selecciona el repositorio.
   - Detectan Vite solos. Si te lo piden: comando de build `npm run build` y carpeta `dist`.
   - Te dan una dirección `https://…` y cada `git push` vuelve a publicar la app.
   - GitHub Pages no sirve aquí: con un repositorio privado solo funciona en los planes de pago de GitHub.
2. **Abrirla en el móvil** con esa dirección y aceptar el permiso del micrófono.
3. **Instalarla** (opcional):
   - **Android (Chrome):** menú ⋮ → *Instalar aplicación* o *Añadir a pantalla de inicio*.
   - **iPhone (Safari):** botón Compartir → *Añadir a pantalla de inicio*.

   Instalada, se abre a pantalla completa y funciona **sin conexión**. Las canciones y sesiones se guardan en el propio teléfono.

**Consejos en el móvil:**
- Usa **auriculares con cable**: los Bluetooth añaden mucha latencia.
- La pantalla no se apaga mientras usas el afinador o practicas.
- En iPhone la referencia suena aunque el interruptor de silencio esté activado (iOS 16.4 o posterior).
- Para cargar canciones, guárdalas antes en *Archivos* (iPhone) o *Descargas* (Android). Los `.mid` y `.wav` se eligen desde ahí.

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

Implementadas las fases 0 a 4 de DISENO.md y de la fase 5: modo libre con DTW, transposición, práctica por fragmentos y PWA instalable que funciona sin conexión.

Pendiente:
- Melodia/Demucs dentro del navegador. Por ahora las canciones completas se analizan con YIN y parámetros más estrictos.
- Exportar el informe a PDF.
- Modelos de IA (CREPE, Basic Pitch).
