// Un único AudioContext para toda la app: el micrófono y la reproducción de la
// referencia comparten así el mismo reloj (ctx.currentTime), imprescindible para
// el modo karaoke. Debe crearse/reanudarse tras un gesto del usuario (Safari/iOS).

let ctx: AudioContext | null = null;

export async function obtenerContexto(): Promise<AudioContext> {
  prepararSesionAudio();
  if (!ctx || ctx.state === "closed") ctx = new AudioContext({ latencyHint: "interactive" });
  // "interrupted" existe en Safari (llamada entrante, cambio de app)
  if ((ctx.state as string) !== "running") await ctx.resume();
  return ctx;
}

/**
 * iOS 16.4+: sesión de audio "play-and-record" para poder grabar y reproducir a la
 * vez, y para que la referencia suene aunque el iPhone esté en modo silencio.
 */
function prepararSesionAudio(): void {
  const sesion = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
  if (sesion && sesion.type !== "play-and-record") {
    try {
      sesion.type = "play-and-record";
    } catch {
      // navegador sin soporte: no pasa nada
    }
  }
}

/** Latencia de salida conocida por el navegador (s); 0 si no la expone. */
export function latenciaSalida(c: AudioContext): number {
  return (c.outputLatency || 0) + (c.baseLatency || 0);
}
