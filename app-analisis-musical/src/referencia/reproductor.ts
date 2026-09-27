// Reproducción de la referencia sobre el AudioContext compartido. Si hay audio
// se usa un AudioBufferSourceNode; si es MIDI se sintetiza la melodía.
import type { Nota } from "../tipos";
import { midiAHz } from "../notas";

export interface FuenteReproduccion {
  audio?: AudioBuffer;
  notas: Nota[];
}

export interface OpcionesReproduccion {
  /** Tiempo de la referencia (s) donde parar; por defecto, el final. */
  hasta?: number;
  /** Nº de clics de cuenta atrás que suenan justo antes de `cuando`. */
  clics?: number;
  /** Separación entre clics (s). */
  pulsoSeg?: number;
  /** Volumen general 0..1. */
  volumen?: number;
  /** Semitonos para transponer la síntesis MIDI (no afecta al audio). */
  transponer?: number;
  /** La de referencia para sintetizar el MIDI. */
  la4?: number;
}

export interface Reproduccion {
  parar(): void;
  /** Instante (ctx.currentTime) en que termina la reproducción. */
  fin: number;
}

const ANTICIPACION = 1.5; // s que se programan por adelantado (síntesis)
const PERIODO_MS = 200;

export function duracionFuente(f: FuenteReproduccion): number {
  let d = f.audio?.duration ?? 0;
  for (const n of f.notas) if (n.fin > d) d = n.fin;
  return d;
}

export function reproducir(
  ctx: AudioContext,
  fuente: FuenteReproduccion,
  cuando: number,
  desde = 0,
  opciones: OpcionesReproduccion = {},
): Reproduccion {
  const hasta = Math.min(opciones.hasta ?? Infinity, duracionFuente(fuente));
  const duracion = Math.max(0, hasta - desde);
  const fin = cuando + duracion;

  const salida = ctx.createGain();
  salida.gain.value = opciones.volumen ?? 0.8;
  salida.connect(ctx.destination);

  const nodos = new Set<AudioScheduledSourceNode>();
  const registrar = (n: AudioScheduledSourceNode) => {
    nodos.add(n);
    n.onended = () => nodos.delete(n);
  };

  if (opciones.clics) programarClics(ctx, salida, cuando, opciones.clics, opciones.pulsoSeg ?? 0.6, registrar);

  let temporizador: ReturnType<typeof setInterval> | null = null;

  if (fuente.audio) {
    const src = ctx.createBufferSource();
    src.buffer = fuente.audio;
    src.connect(salida);
    // si `cuando` ya pasó, se entra con el desfase correspondiente
    const retraso = Math.max(0, ctx.currentTime - cuando);
    if (retraso < duracion) {
      src.start(Math.max(cuando, ctx.currentTime), desde + retraso, duracion - retraso);
      registrar(src);
    }
  } else {
    const notas = fuente.notas
      .filter((n) => n.fin > desde && n.inicio < hasta)
      .sort((a, b) => a.inicio - b.inicio);
    const la4 = opciones.la4 ?? 440;
    const transponer = opciones.transponer ?? 0;
    let siguiente = 0;
    const programar = () => {
      const limite = ctx.currentTime + ANTICIPACION;
      while (siguiente < notas.length) {
        const n = notas[siguiente];
        const ini = cuando + Math.max(n.inicio, desde) - desde;
        if (ini > limite) break;
        siguiente++;
        const fn = cuando + Math.min(n.fin, hasta) - desde;
        if (fn <= ctx.currentTime) continue;
        tocarNota(ctx, salida, midiAHz(n.midi + transponer, la4), Math.max(ini, ctx.currentTime), fn, registrar);
      }
      if (siguiente >= notas.length && temporizador) {
        clearInterval(temporizador);
        temporizador = null;
      }
    };
    programar();
    if (siguiente < notas.length) temporizador = setInterval(programar, PERIODO_MS);
  }

  let parada = false;
  return {
    fin,
    parar() {
      if (parada) return;
      parada = true;
      if (temporizador) clearInterval(temporizador);
      const ahora = ctx.currentTime;
      // fundido breve para evitar chasquidos
      salida.gain.cancelScheduledValues(ahora);
      salida.gain.setValueAtTime(salida.gain.value, ahora);
      salida.gain.linearRampToValueAtTime(0, ahora + 0.05);
      for (const n of nodos) {
        try {
          n.stop(ahora + 0.06);
        } catch {
          // ya parado o sin iniciar
        }
      }
      setTimeout(() => salida.disconnect(), 150);
    },
  };
}

/** Nota sintetizada: onda triangular con envolvente ADSR suave. */
function tocarNota(
  ctx: AudioContext,
  destino: AudioNode,
  hz: number,
  ini: number,
  fin: number,
  registrar: (n: AudioScheduledSourceNode) => void,
) {
  const pico = 0.22;
  const sostenido = pico * 0.7;
  const ataque = 0.02;
  const caida = 0.12;
  const liberacion = 0.08;
  const dur = Math.max(0.05, fin - ini);

  const osc = ctx.createOscillator();
  osc.type = "triangle";
  osc.frequency.value = hz;
  const env = ctx.createGain();
  env.gain.setValueAtTime(0, ini);
  env.gain.linearRampToValueAtTime(pico, ini + Math.min(ataque, dur / 2));
  if (dur > ataque + caida) env.gain.linearRampToValueAtTime(sostenido, ini + ataque + caida);
  env.gain.setValueAtTime(dur > ataque + caida ? sostenido : pico, ini + dur);
  env.gain.linearRampToValueAtTime(0, ini + dur + liberacion);
  osc.connect(env).connect(destino);
  osc.start(ini);
  osc.stop(ini + dur + liberacion + 0.02);
  registrar(osc);
}

/** Clics de cuenta atrás: el primero acentuado; el último cae un pulso antes de `cuando`. */
function programarClics(
  ctx: AudioContext,
  destino: AudioNode,
  cuando: number,
  n: number,
  pulso: number,
  registrar: (n: AudioScheduledSourceNode) => void,
) {
  for (let i = 0; i < n; i++) {
    const t = cuando - (n - i) * pulso;
    if (t < ctx.currentTime) continue;
    const osc = ctx.createOscillator();
    osc.type = "square";
    osc.frequency.value = i === 0 ? 1760 : 1320;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(0.25, t + 0.002);
    env.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
    osc.connect(env).connect(destino);
    osc.start(t);
    osc.stop(t + 0.08);
    registrar(osc);
  }
}
