// Generadores de señales sintéticas para los tests (sin DOM).
import { midiAHz } from "../notas";

export const SR = 22050;

export interface NotaSintetica {
  inicio: number;
  fin: number;
  midi: number;
  /** Vibrato: amplitud en cents y frecuencia en Hz. */
  vibrato?: { cents: number; hz: number };
}

/** Voz "sintética": fundamental + armónicos decrecientes, con rampas de 10 ms. */
export function sintetizar(notas: NotaSintetica[], duracion: number, sr = SR, amplitud = 0.3): Float32Array {
  const x = new Float32Array(Math.ceil(duracion * sr));
  const armonicos = [1, 0.6, 0.4, 0.25, 0.15, 0.1];
  for (const n of notas) {
    const f0 = midiAHz(n.midi);
    const a = Math.round(n.inicio * sr);
    const b = Math.min(x.length, Math.round(n.fin * sr));
    const rampa = Math.round(0.01 * sr);
    let fase = 0;
    for (let i = a; i < b; i++) {
      const t = (i - a) / sr;
      const f = n.vibrato ? f0 * Math.pow(2, (n.vibrato.cents / 1200) * Math.sin(2 * Math.PI * n.vibrato.hz * t)) : f0;
      fase += (2 * Math.PI * f) / sr;
      let s = 0;
      for (let h = 0; h < armonicos.length; h++) s += armonicos[h] * Math.sin((h + 1) * fase);
      const env = Math.min(1, (i - a) / rampa, (b - i) / rampa);
      x[i] += amplitud * env * s * 0.5;
    }
  }
  return x;
}

/** Ruido blanco pseudoaleatorio reproducible. */
export function ruido(duracion: number, sr = SR, amplitud = 0.2, semilla = 1): Float32Array {
  const x = new Float32Array(Math.ceil(duracion * sr));
  let s = semilla >>> 0;
  for (let i = 0; i < x.length; i++) {
    s = (s * 1664525 + 1013904223) >>> 0;
    x[i] = amplitud * (s / 2 ** 32 - 0.5) * 2;
  }
  return x;
}
