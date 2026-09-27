// Alineación temporal por DTW (modo libre) con banda de Sakoe-Chiba.

import type { Contorno, Referencia } from "../tipos";
import { aRejilla, curvaReferencia, distanciaClase } from "./utilidades";

/** Paso de remuestreo del DTW (s): acota memoria y tiempo. */
const PASO_DTW = 0.02;
/** Coste fijo (semitonos) de emparejar voz con silencio. */
const PENALIZACION_SILENCIO = 1;

function tramoConVoz(v: Float64Array): [number, number] {
  let a = 0;
  while (a < v.length && Number.isNaN(v[a])) a++;
  let b = v.length - 1;
  while (b >= a && Number.isNaN(v[b])) b--;
  return [a, b];
}

function coste(u: number, r: number): number {
  const hu = !Number.isNaN(u);
  const hr = !Number.isNaN(r);
  if (hu && hr) return distanciaClase(u, r);
  return hu === hr ? 0 : PENALIZACION_SILENCIO;
}

/**
 * Re-temporiza el contorno del usuario al eje de tiempo de la referencia.
 * Recorta los silencios de los extremos, remuestrea a 20 ms y busca el camino
 * de mínimo coste dentro de una banda de ±bandaSeg alrededor de la diagonal.
 * Memoria O(n · banda), no O(n · m).
 */
export function alinearDTW(usuario: Contorno, ref: Referencia, bandaSeg = 2): Contorno {
  const R = curvaReferencia(ref, PASO_DTW);
  const U = aRejilla(usuario, PASO_DTW);
  const salida: Contorno = [];
  for (let k = 0; k < R.midi.length; k++) salida.push({ t: k * PASO_DTW, midi: null, claridad: 0 });

  const [ra, rb] = tramoConVoz(R.midi);
  const [ua, ub] = tramoConVoz(U.midi);
  if (rb < ra || ub < ua) return salida;

  const n = rb - ra + 1;
  const m = ub - ua + 1;
  const radio = Math.max(1, Math.ceil(bandaSeg / PASO_DTW));
  const ancho = 2 * radio + 1;
  const pendiente = n > 1 ? (m - 1) / (n - 1) : 0;
  // Primera columna (índice de usuario) representada en cada fila.
  const base = new Int32Array(n);
  for (let i = 0; i < n; i++) base[i] = Math.round(i * pendiente) - radio;

  const D = new Float32Array(n * ancho).fill(Infinity);
  // 0 = diagonal, 1 = desde (i−1, j), 2 = desde (i, j−1)
  const dir = new Uint8Array(n * ancho);
  const leer = (i: number, j: number): number => {
    if (i < 0 || j < 0) return Infinity;
    const c = j - base[i];
    return c >= 0 && c < ancho ? D[i * ancho + c] : Infinity;
  };

  for (let i = 0; i < n; i++) {
    const r = R.midi[ra + i];
    const jIni = Math.max(0, base[i]);
    const jFin = Math.min(m - 1, base[i] + ancho - 1);
    for (let j = jIni; j <= jFin; j++) {
      const c = coste(U.midi[ua + j], r);
      const idx = i * ancho + (j - base[i]);
      if (i === 0 && j === 0) {
        D[idx] = c;
        continue;
      }
      const dg = leer(i - 1, j - 1);
      const ar = leer(i - 1, j);
      const iz = leer(i, j - 1);
      let mejor = dg;
      let d = 0;
      if (ar < mejor) {
        mejor = ar;
        d = 1;
      }
      if (iz < mejor) {
        mejor = iz;
        d = 2;
      }
      D[idx] = mejor + c;
      dir[idx] = d;
    }
  }

  // Recorre el camino hacia atrás acumulando el pitch emparejado a cada fila.
  const suma = new Float64Array(n);
  const clar = new Float64Array(n);
  const cuenta = new Uint32Array(n);
  let i = n - 1;
  let j = m - 1;
  if (!Number.isFinite(leer(i, j))) return salida;
  for (;;) {
    const v = U.midi[ua + j];
    if (!Number.isNaN(v)) {
      suma[i] += v;
      clar[i] += U.claridad[ua + j];
      cuenta[i]++;
    }
    if (i === 0 && j === 0) break;
    const d = dir[i * ancho + (j - base[i])];
    if (d === 0) {
      i--;
      j--;
    } else if (d === 1) i--;
    else j--;
  }

  for (let k = 0; k < n; k++) {
    if (cuenta[k] > 0) {
      salida[ra + k].midi = suma[k] / cuenta[k];
      salida[ra + k].claridad = clar[k] / cuenta[k];
    }
  }
  return salida;
}
