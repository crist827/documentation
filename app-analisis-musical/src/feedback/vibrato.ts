// Detección de vibrato y su eliminación de una serie de pitch sin tendencia.

import { desviacion } from "../comparacion/utilidades";

export const VIBRATO_HZ_MIN = 4;
export const VIBRATO_HZ_MAX = 8;
/** Por debajo de esta amplitud (±cents) la oscilación no se considera vibrato. */
const AMPLITUD_MINIMA = 8;
/** Autocorrelación normalizada mínima para aceptar la periodicidad. */
const CORRELACION_MINIMA = 0.4;

/**
 * Busca una oscilación periódica de 4–8 Hz por autocorrelación.
 * `residuo`: pitch en cents sin tendencia, muestreado cada `paso` segundos.
 */
export function detectarVibrato(
  residuo: ArrayLike<number>,
  paso: number,
): { hz: number; amplitudCents: number } | undefined {
  const n = residuo.length;
  // Buscamos en un rango algo más amplio para distinguir picos del borde.
  const lagMin = Math.max(2, Math.floor(1 / (VIBRATO_HZ_MAX + 1) / paso));
  const lagMax = Math.ceil(1 / (VIBRATO_HZ_MIN - 1) / paso);
  if (n < lagMax + 5) return undefined;

  let energia = 0;
  for (let i = 0; i < n; i++) energia += residuo[i] * residuo[i];
  energia /= n;
  if (energia <= 0) return undefined;

  const ac = new Float64Array(lagMax + 2);
  for (let k = lagMin - 1; k <= lagMax + 1 && k < n; k++) {
    let s = 0;
    for (let i = 0; i + k < n; i++) s += residuo[i] * residuo[i + k];
    ac[k] = s / (n - k) / energia;
  }

  let mejor = -1;
  for (let k = lagMin; k <= lagMax; k++) {
    if (ac[k] > ac[k - 1] && ac[k] >= ac[k + 1] && (mejor < 0 || ac[k] > ac[mejor])) mejor = k;
  }
  if (mejor < 0 || ac[mejor] < CORRELACION_MINIMA) return undefined;

  // Interpolación parabólica del pico para afinar el periodo.
  const a = ac[mejor - 1];
  const b = ac[mejor];
  const c = ac[mejor + 1];
  const den = a - 2 * b + c;
  const delta = den !== 0 ? (0.5 * (a - c)) / den : 0;
  const hz = 1 / ((mejor + delta) * paso);
  if (hz < VIBRATO_HZ_MIN || hz > VIBRATO_HZ_MAX) return undefined;

  // En una senoide, amplitud = √2 · desviación típica.
  const amplitudCents = Math.SQRT2 * desviacion(residuo);
  if (amplitudCents < AMPLITUD_MINIMA) return undefined;
  return { hz, amplitudCents };
}

/**
 * Quita el vibrato con una media móvil de un periodo (anula la componente
 * periódica). Devuelve solo las muestras con ventana completa.
 */
export function quitarVibrato(serie: ArrayLike<number>, paso: number, hz: number): Float64Array {
  const w = Math.max(1, Math.round(1 / hz / paso));
  const n = serie.length - w + 1;
  if (n <= 0) return Float64Array.from(serie);
  const out = new Float64Array(n);
  let s = 0;
  for (let i = 0; i < w; i++) s += serie[i];
  out[0] = s / w;
  for (let i = 1; i < n; i++) {
    s += serie[i + w - 1] - serie[i - 1];
    out[i] = s / w;
  }
  return out;
}
