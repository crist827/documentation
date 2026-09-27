// Un único AudioContext para toda la app: el micrófono y la reproducción de la
// referencia comparten así el mismo reloj (ctx.currentTime), imprescindible para
// el modo karaoke. Debe crearse/reanudarse tras un gesto del usuario (Safari/iOS).

let ctx: AudioContext | null = null;

export async function obtenerContexto(): Promise<AudioContext> {
  if (!ctx || ctx.state === "closed") ctx = new AudioContext({ latencyHint: "interactive" });
  if (ctx.state === "suspended") await ctx.resume();
  return ctx;
}

/** Latencia de salida conocida por el navegador (s); 0 si no la expone. */
export function latenciaSalida(c: AudioContext): number {
  return (c.outputLatency || 0) + (c.baseLatency || 0);
}
