// Utilidades puras para practicar un fragmento de la referencia.
import type { Contorno, Nota, Referencia } from "../tipos";
import { mediana } from "../notas";

export interface Fragmento {
  inicio: number;
  fin: number;
}

/** Normaliza un fragmento a [0, duracion]; null si no es válido o cubre toda la canción. */
export function normalizarFragmento(
  inicio: number | null,
  fin: number | null,
  duracion: number,
): Fragmento | null {
  const i = Math.max(0, inicio ?? 0);
  const f = Math.min(duracion, fin ?? duracion);
  if (!Number.isFinite(i) || !Number.isFinite(f) || f - i < 0.5) return null;
  if (i <= 0 && f >= duracion) return null;
  return { inicio: i, fin: f };
}

/**
 * Referencia limitada a un fragmento. Los tiempos se mantienen absolutos
 * (no se rebasan a 0) para que el informe cuadre con la canción completa.
 */
export function recortarReferencia(ref: Referencia, frag: Fragmento): Referencia {
  const notas: Nota[] = ref.notas
    .filter((n) => n.inicio >= frag.inicio - 0.05 && n.inicio < frag.fin)
    .map((n) => (n.fin > frag.fin ? { ...n, fin: frag.fin } : n));
  const contorno = ref.contorno?.filter((p) => p.t >= frag.inicio && p.t <= frag.fin);
  return { ...ref, notas, contorno, duracion: frag.fin };
}

/** Suma `dt` segundos a todos los tiempos del contorno. */
export function desplazarContorno(c: Contorno, dt: number): Contorno {
  if (dt === 0) return c;
  return c.map((p) => ({ ...p, t: p.t + dt }));
}

/** Nota de la lista que suena en el instante t (búsqueda binaria; notas ordenadas). */
export function notaEn(notas: Nota[], t: number): Nota | null {
  let lo = 0;
  let hi = notas.length - 1;
  while (lo <= hi) {
    const m = (lo + hi) >> 1;
    const n = notas[m];
    if (t < n.inicio) hi = m - 1;
    else if (t >= n.fin) lo = m + 1;
    else return n;
  }
  return null;
}

/** Duración efectiva: la declarada o el fin de la última nota/punto. */
export function duracionReferencia(ref: Referencia): number {
  let d = ref.duracion || 0;
  for (const n of ref.notas) if (n.fin > d) d = n.fin;
  const c = ref.contorno;
  if (c && c.length) d = Math.max(d, c[c.length - 1].t);
  return d;
}

/**
 * Octavas de diferencia (usuario − referencia) en los últimos puntos del
 * contorno a partir de `desde`, para dibujar la voz en vivo a la altura de la
 * referencia. 0 si hay pocos datos.
 */
export function octavaEnVivo(c: Contorno, notas: Nota[], desde: number, transposicion = 0): number {
  const difs: number[] = [];
  for (let i = c.length - 1; i >= 0 && c[i].t >= desde; i--) {
    const p = c[i];
    if (p.midi == null) continue;
    const n = notaEn(notas, p.t);
    if (n) difs.push(Math.round((p.midi - transposicion - n.midi) / 12));
  }
  if (difs.length < 10) return 0;
  return Math.max(-2, Math.min(2, Math.round(mediana(difs)))) + 0;
}
