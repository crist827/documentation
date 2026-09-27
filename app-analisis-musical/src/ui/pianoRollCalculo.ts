// Cálculos puros del piano-roll (rango, escalas, búsquedas).
import type { Contorno, Nota } from "../tipos";

/** Rango MIDI entero [min, max] que abarca notas y contornos, con margen y un mínimo de 12 semitonos. */
export function rangoMidi(
  notas: Nota[],
  contornos: (Contorno | undefined)[],
  margen = 2,
  minimo = 12,
): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const n of notas) {
    if (n.midi < lo) lo = n.midi;
    if (n.midi > hi) hi = n.midi;
  }
  for (const c of contornos) {
    if (!c) continue;
    for (const p of c) {
      if (p.midi == null) continue;
      if (p.midi < lo) lo = p.midi;
      if (p.midi > hi) hi = p.midi;
    }
  }
  if (!Number.isFinite(lo)) {
    lo = 57;
    hi = 69;
  }
  let min = Math.floor(lo) - margen;
  let max = Math.ceil(hi) + margen;
  if (max - min < minimo) {
    const falta = minimo - (max - min);
    min -= Math.floor(falta / 2);
    max += Math.ceil(falta / 2);
  }
  return [Math.max(0, min), Math.min(127, max)];
}

/** Paso de marcas del eje de tiempo para que queden separadas al menos `minPx`. */
export function pasoMarcas(spanSeg: number, anchoPx: number, minPx = 70): number {
  const pasos = [0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300];
  for (const p of pasos) if ((p / spanSeg) * anchoPx >= minPx) return p;
  return pasos[pasos.length - 1];
}

/** Primer índice con t >= valor (contorno ordenado por t). */
export function indiceDesde(c: Contorno, t: number): number {
  let lo = 0;
  let hi = c.length;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (c[m].t < t) lo = m + 1;
    else hi = m;
  }
  return lo;
}

/** Etiqueta corta de tiempo para el eje: "12 s" o "1:05". */
export function etiquetaTiempo(t: number): string {
  if (t < 60) return `${Number.isInteger(t) ? t : t.toFixed(t % 0.5 === 0 ? 1 : 2)} s`;
  const m = Math.floor(t / 60);
  const s = Math.round(t - m * 60);
  return `${m}:${s < 10 ? "0" : ""}${s}`;
}

export function esTeclaNegra(midi: number): boolean {
  return [1, 3, 6, 8, 10].includes(((midi % 12) + 12) % 12);
}

/** Duración total visible: máximo fin de notas y contornos. */
export function duracionTotal(notas: Nota[], contornos: (Contorno | undefined)[]): number {
  let d = 0;
  for (const n of notas) if (n.fin > d) d = n.fin;
  for (const c of contornos) if (c && c.length && c[c.length - 1].t > d) d = c[c.length - 1].t;
  return d;
}
