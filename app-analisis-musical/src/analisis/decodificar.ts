// Decodificación y conversión a mono con Web Audio (hilo principal).

/** Frecuencia a la que se decodifica el audio original (se reproduce igual en cualquier contexto). */
const SR_DECODIFICACION = 44100;

export async function decodificarAudio(datos: ArrayBuffer): Promise<AudioBuffer> {
  if (typeof OfflineAudioContext === "undefined") {
    throw new Error("Este navegador no soporta Web Audio.");
  }
  const ctx = new OfflineAudioContext(2, 1, SR_DECODIFICACION);
  try {
    // decodeAudioData "consume" el ArrayBuffer: se le pasa una copia.
    return await ctx.decodeAudioData(datos.slice(0));
  } catch {
    throw new Error("No se pudo decodificar el audio. El formato no es compatible con este navegador o el archivo está dañado.");
  }
}

/** Mezcla todos los canales a mono y remuestrea a `srObjetivo` con OfflineAudioContext. */
export async function aMono(buf: AudioBuffer, srObjetivo = 22050): Promise<Float32Array> {
  const largo = Math.max(1, Math.ceil(buf.duration * srObjetivo));
  const ctx = new OfflineAudioContext(1, largo, srObjetivo);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  if (buf.numberOfChannels > 2) {
    // Más de 2 canales: promedio explícito (el downmix por defecto no lo es).
    const div = ctx.createChannelSplitter(buf.numberOfChannels);
    const g = ctx.createGain();
    g.gain.value = 1 / buf.numberOfChannels;
    src.connect(div);
    for (let c = 0; c < buf.numberOfChannels; c++) div.connect(g, c);
    g.connect(ctx.destination);
  } else {
    // Mono o estéreo: el downmix "speakers" a 1 canal hace (L + R) / 2.
    src.connect(ctx.destination);
  }
  src.start(0);
  const res = await ctx.startRendering();
  return res.getChannelData(0).slice();
}
