// Diferencia de octava dominante entre el usuario y la referencia.

import type { Contorno, Referencia } from "../tipos";
import { mediana } from "../notas";
import { aRejilla, curvaReferencia, limitar, PASO_REJILLA } from "./utilidades";

/**
 * Octavas (entero −2..2) que el usuario canta desplazado: mediana de
 * round((usuario − ref) / 12) sobre los frames con voz en ambos.
 * Espera el contorno ya alineado en el tiempo de la referencia.
 */
export function estimarOctava(usuario: Contorno, ref: Referencia): number {
  const r = curvaReferencia(ref, PASO_REJILLA).midi;
  const u = aRejilla(usuario, PASO_REJILLA).midi;
  const difs: number[] = [];
  const n = Math.min(r.length, u.length);
  for (let k = 0; k < n; k++) {
    if (!Number.isNaN(r[k]) && !Number.isNaN(u[k])) difs.push(Math.round((u[k] - r[k]) / 12));
  }
  if (difs.length === 0) return 0;
  // "+ 0" evita devolver −0.
  return limitar(Math.round(mediana(difs)), -2, 2) + 0;
}
