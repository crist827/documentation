// Utilidades numéricas compartidas por la comparación y el feedback.

import type { Contorno, Referencia } from "../tipos";

/** Paso de la rejilla interna de trabajo (s). */
export const PASO_REJILLA = 0.01;
const EPS = 1e-6;

/** Distancia circular por clase de octava, en semitonos (0..6). */
export function distanciaClase(a: number, b: number): number {
  const x = (((a - b) % 12) + 12) % 12;
  return Math.min(x, 12 - x);
}

export function media(v: ArrayLike<number>): number {
  if (v.length === 0) return 0;
  let s = 0;
  for (let i = 0; i < v.length; i++) s += v[i];
  return s / v.length;
}

/** Desviación típica poblacional (0 si hay menos de 2 valores). */
export function desviacion(v: ArrayLike<number>): number {
  if (v.length < 2) return 0;
  const m = media(v);
  let s = 0;
  for (let i = 0; i < v.length; i++) s += (v[i] - m) ** 2;
  return Math.sqrt(s / v.length);
}

export function limitar(x: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, x));
}

/** Regresión lineal y = a + b·x. Devuelve pendiente, ordenada y residuos. */
export function regresion(x: ArrayLike<number>, y: ArrayLike<number>) {
  const n = x.length;
  const mx = media(x);
  const my = media(y);
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < n; i++) {
    sxy += (x[i] - mx) * (y[i] - my);
    sxx += (x[i] - mx) ** 2;
  }
  const pendiente = sxx > 0 ? sxy / sxx : 0;
  const ordenada = my - pendiente * mx;
  const residuos = new Float64Array(n);
  for (let i = 0; i < n; i++) residuos[i] = y[i] - (ordenada + pendiente * x[i]);
  return { pendiente, ordenada, residuos };
}

/** Paso típico entre frames de un contorno (mediana de las diferencias). */
export function pasoContorno(c: Contorno): number {
  const difs: number[] = [];
  for (let i = 1; i < c.length && difs.length < 400; i++) {
    const d = c[i].t - c[i - 1].t;
    if (d > 0) difs.push(d);
  }
  if (difs.length === 0) return PASO_REJILLA;
  difs.sort((a, b) => a - b);
  return difs[difs.length >> 1];
}

/** Contorno en rejilla uniforme: `midi` es NaN en silencio. */
export interface Rejilla {
  paso: number;
  midi: Float64Array;
  claridad: Float64Array;
}

/**
 * Remuestrea un contorno a una rejilla uniforme que empieza en t = 0.
 * Cada casilla [k·paso, (k+1)·paso) promedia los frames con voz; es silencio
 * si predominan los frames sin voz.
 */
export function aRejilla(c: Contorno, paso: number, duracion?: number): Rejilla {
  let fin = duracion ?? 0;
  for (const p of c) if (p.t > fin) fin = p.t;
  const n = Math.max(0, Math.floor(fin / paso + EPS) + 1);
  const suma = new Float64Array(n);
  const sumaClar = new Float64Array(n);
  const conVoz = new Uint32Array(n);
  const sinVoz = new Uint32Array(n);
  for (const p of c) {
    const k = Math.floor(p.t / paso + EPS);
    if (k < 0 || k >= n) continue;
    if (p.midi == null || !Number.isFinite(p.midi)) sinVoz[k]++;
    else {
      suma[k] += p.midi;
      sumaClar[k] += p.claridad;
      conVoz[k]++;
    }
  }
  const midi = new Float64Array(n).fill(NaN);
  const claridad = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    if (conVoz[k] > 0 && conVoz[k] >= sinVoz[k]) {
      midi[k] = suma[k] / conVoz[k];
      claridad[k] = sumaClar[k] / conVoz[k];
    }
  }
  return { paso, midi, claridad };
}

/**
 * Curva de referencia continua: el contorno si existe; si no (MIDI),
 * una curva escalonada generada a partir de las notas.
 */
export function curvaReferencia(ref: Referencia, paso = PASO_REJILLA): Rejilla {
  if (ref.contorno && ref.contorno.some((p) => p.midi != null)) {
    return aRejilla(ref.contorno, paso, ref.duracion);
  }
  let fin = ref.duracion || 0;
  for (const n of ref.notas) if (n.fin > fin) fin = n.fin;
  const len = Math.floor(fin / paso + EPS) + 1;
  const midi = new Float64Array(len).fill(NaN);
  const claridad = new Float64Array(len);
  for (const n of ref.notas) {
    const a = Math.max(0, Math.ceil(n.inicio / paso - EPS));
    const b = Math.min(len - 1, Math.ceil(n.fin / paso - EPS) - 1);
    for (let k = a; k <= b; k++) {
      midi[k] = n.midi;
      claridad[k] = 1;
    }
  }
  return { paso, midi, claridad };
}
