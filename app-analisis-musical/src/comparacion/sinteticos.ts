// Generadores de datos sintéticos para los tests de comparación y feedback.

import type { Contorno, Nota, Referencia } from "../tipos";
import { midiAHz } from "../notas";

export function nota(midi: number, inicio: number, fin: number): Nota {
  return { midi, inicio, fin, hz: midiAHz(midi) };
}

export function referencia(notas: Nota[], id = "ref"): Referencia {
  const duracion = notas.reduce((m, n) => Math.max(m, n.fin), 0) + 0.5;
  return { id, nombre: `Referencia ${id}`, tipo: "midi", duracion, notas };
}

/** Melodía de prueba con grados conjuntos, saltos y pequeñas pausas. */
export function melodia(): Referencia {
  const alturas = [60, 62, 64, 65, 67, 72, 71, 69, 67, 64, 62, 60, 65, 69, 67];
  const duraciones = [0.5, 0.4, 0.6, 0.5, 1.2, 0.8, 0.4, 0.5, 1.0, 0.6, 0.4, 0.8, 0.5, 0.7, 1.2];
  const notas: Nota[] = [];
  let t = 0.5;
  alturas.forEach((m, i) => {
    notas.push(nota(m, t, t + duraciones[i]));
    t += duraciones[i] + (i % 3 === 2 ? 0.2 : 0);
  });
  return referencia(notas, "melodia");
}

/** Contorno a 10 ms a partir de una función t → midi (null = silencio). */
export function contorno(duracion: number, f: (t: number) => number | null, paso = 0.01): Contorno {
  const c: Contorno = [];
  const n = Math.round(duracion / paso);
  for (let k = 0; k <= n; k++) {
    const t = Math.round(k * paso * 1e6) / 1e6;
    const midi = f(t);
    c.push({ t, midi, claridad: midi == null ? 0 : 0.95 });
  }
  return c;
}

/** Altura de la referencia en el instante t (null fuera de las notas). */
export function alturaEn(ref: Referencia, t: number): number | null {
  for (const n of ref.notas) if (t >= n.inicio - 1e-9 && t < n.fin - 1e-9) return n.midi;
  return null;
}

export interface Imitacion {
  /** Segundos de retraso del usuario. */
  retraso?: number;
  /** Desvío constante en semitonos. */
  desvio?: number;
  /** Velocidad relativa (0.85 = canta más lento). */
  velocidad?: number;
}

/** Usuario que imita la referencia con retraso, desvío o tempo distinto. */
export function imitar(ref: Referencia, o: Imitacion = {}): Contorno {
  const { retraso = 0, desvio = 0, velocidad = 1 } = o;
  const dur = (ref.duracion + retraso) / velocidad;
  return contorno(dur, (t) => {
    const h = alturaEn(ref, (t - retraso) * velocidad);
    return h == null ? null : h + desvio;
  });
}
