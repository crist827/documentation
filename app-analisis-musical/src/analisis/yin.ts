// Detector de pitch YIN (de Cheveigné y Kawahara, 2002) y contorno suavizado de un audio completo.
import type { Contorno, PuntoPitch } from "../tipos";
import { hzAMidi } from "../notas";

export interface OpcionesContorno {
  minHz: number;
  maxHz: number;
  /** Claridad mínima (1 − d'(τ)) para aceptar un frame como sonoro. */
  claridadMin: number;
  /** Salto entre frames en segundos. */
  hopSeg: number;
  /** Tamaño de ventana en muestras a 44.1 kHz (se escala a la frecuencia real). */
  ventana: number;
  /** Puerta de energía: frames con RMS por debajo (dBFS) se consideran silencio. */
  rmsMinDb: number;
}

export const OPCIONES_ACAPELLA: OpcionesContorno = {
  minHz: 65,
  maxHz: 1100,
  claridadMin: 0.7,
  hopSeg: 0.01,
  ventana: 2048,
  rmsMinDb: -50,
};

/** Canción completa: más exigente para no seguir a los instrumentos. */
export const OPCIONES_CANCION: OpcionesContorno = {
  minHz: 80,
  maxHz: 1000,
  claridadMin: 0.85,
  hopSeg: 0.01,
  ventana: 2048,
  rmsMinDb: -40,
};

const UMBRAL_YIN = 0.12;

/**
 * YIN sobre un frame. Usa τ ∈ [sr/maxHz, sr/minHz] y una ventana de integración
 * W = longitud − τmax. Devuelve hz = null si no hay periodo plausible.
 */
export function yinFrame(
  frame: Float32Array,
  sampleRate: number,
  minHz: number,
  maxHz: number,
  umbral = UMBRAL_YIN,
): { hz: number | null; claridad: number } {
  const tauMax = Math.min(Math.ceil(sampleRate / minHz) + 1, Math.floor(frame.length / 2));
  const tauMin = Math.max(2, Math.floor(sampleRate / maxHz));
  const w = frame.length - tauMax;
  if (tauMax <= tauMin + 2 || w <= 0) return { hz: null, claridad: 0 };
  const d = difNormalizada(frame, w, tauMax);
  return elegirPeriodo(d, tauMin, tauMax, sampleRate, umbral);
}

/**
 * Función diferencia + diferencia normalizada acumulada (pasos 2 y 3 de YIN). d[0] = 1.
 * d(τ) = Σx_j² + Σx_{j+τ}² − 2·Σx_j·x_{j+τ}: las energías salen de sumas deslizantes y
 * solo la correlación cuesta O(W) por τ (bucle desenrollado ×4).
 */
function difNormalizada(x: Float32Array, w: number, tauMax: number, d = new Float32Array(tauMax + 1)): Float32Array {
  d[0] = 1;
  let e0 = 0;
  for (let j = 0; j < w; j++) e0 += x[j] * x[j];
  let et = e0; // energía de x[τ .. τ+W)
  let acum = 0;
  const w4 = w - (w % 4);
  for (let tau = 1; tau <= tauMax; tau++) {
    et += x[tau + w - 1] * x[tau + w - 1] - x[tau - 1] * x[tau - 1];
    let r0 = 0;
    let r1 = 0;
    let r2 = 0;
    let r3 = 0;
    let j = 0;
    for (; j < w4; j += 4) {
      r0 += x[j] * x[j + tau];
      r1 += x[j + 1] * x[j + 1 + tau];
      r2 += x[j + 2] * x[j + 2 + tau];
      r3 += x[j + 3] * x[j + 3 + tau];
    }
    for (; j < w; j++) r0 += x[j] * x[j + tau];
    const s = Math.max(0, e0 + et - 2 * (r0 + r1 + r2 + r3));
    acum += s;
    d[tau] = acum > 0 ? (s * tau) / acum : 1;
  }
  return d;
}

/** Umbral absoluto, mínimo local e interpolación parabólica (pasos 4 y 5). */
function elegirPeriodo(
  d: Float32Array,
  tauMin: number,
  tauMax: number,
  sampleRate: number,
  umbral: number,
): { hz: number | null; claridad: number } {
  let tau = -1;
  for (let t = tauMin; t < tauMax; t++) {
    if (d[t] < umbral) {
      while (t + 1 < tauMax && d[t + 1] < d[t]) t++;
      tau = t;
      break;
    }
  }
  if (tau < 0) {
    // Sin cruce del umbral: mínimo global (claridad baja; la decide el llamador).
    tau = tauMin;
    for (let t = tauMin + 1; t < tauMax; t++) if (d[t] < d[tau]) tau = t;
  }
  // Un mínimo en el borde del rango no es un periodo fiable.
  if (tau <= tauMin || tau >= tauMax - 1) {
    if (d[tau] >= umbral) return { hz: null, claridad: Math.max(0, 1 - d[tau]) };
  }
  let tauFino = tau;
  let dMin = d[tau];
  if (tau > 0 && tau < tauMax) {
    const a = d[tau - 1];
    const b = d[tau];
    const c = d[tau + 1];
    const den = a - 2 * b + c;
    if (den > 0) {
      const delta = (0.5 * (a - c)) / den;
      if (Math.abs(delta) < 1) {
        tauFino = tau + delta;
        dMin = b - 0.25 * (a - c) * delta;
      }
    }
  }
  const claridad = Math.min(1, Math.max(0, 1 - dMin));
  return { hz: sampleRate / tauFino, claridad };
}

/** Contorno de pitch de un audio mono completo, ya suavizado. `t` = centro de la ventana. */
export function contornoDesdeAudio(
  muestras: Float32Array,
  sampleRate: number,
  opciones?: Partial<OpcionesContorno>,
  onProgreso?: (p: number) => void,
): Contorno {
  const op = { ...OPCIONES_ACAPELLA, ...opciones };
  const hop = Math.max(1, Math.round(op.hopSeg * sampleRate));
  const hopSeg = hop / sampleRate;
  const tauMax = Math.ceil(sampleRate / op.minHz) + 1;
  const tauMin = Math.max(2, Math.floor(sampleRate / op.maxHz));
  // Ventana escalada; la integración debe cubrir al menos un periodo del grave.
  const nEscalada = Math.round((op.ventana * sampleRate) / 44100);
  const w = Math.max(nEscalada - tauMax, tauMax);
  const n = w + tauMax;
  const medio = n >> 1;

  // Copia con ceros a ambos lados: el frame i está centrado en la muestra i·hop.
  const x = new Float32Array(muestras.length + n + 1);
  x.set(muestras, medio);
  const numFrames = Math.floor(muestras.length / hop) + 1;

  // RMS sobre la parte central (±hop·1.5) para que los ataques no se adelanten.
  const rmsMedio = Math.max(hop, Math.round(1.5 * hop));
  const rmsMin = Math.pow(10, op.rmsMinDb / 20);

  const d = new Float32Array(tauMax + 1);
  const crudo: PuntoPitch[] = new Array(numFrames);
  const pasoProgreso = Math.max(1, Math.floor(numFrames / 50));
  for (let i = 0; i < numFrames; i++) {
    const t = i * hopSeg;
    const ini = i * hop; // en x (ya desplazado por `medio`)
    const c = ini + medio;
    let e = 0;
    const a = Math.max(0, c - rmsMedio);
    const b = Math.min(x.length, c + rmsMedio);
    for (let j = a; j < b; j++) e += x[j] * x[j];
    const rms = Math.sqrt(e / Math.max(1, b - a));
    if (rms < rmsMin) {
      crudo[i] = { t, midi: null, claridad: 0 };
    } else {
      const frame = x.subarray(ini, ini + n);
      difNormalizada(frame, w, tauMax, d);
      const r = elegirPeriodo(d, tauMin, tauMax, sampleRate, UMBRAL_YIN);
      const ok = r.hz !== null && r.claridad >= op.claridadMin && r.hz >= op.minHz && r.hz <= op.maxHz;
      crudo[i] = { t, midi: ok ? hzAMidi(r.hz as number) : null, claridad: r.claridad };
    }
    if (onProgreso && i % pasoProgreso === 0) onProgreso(i / numFrames);
  }
  onProgreso?.(1);

  const suave = corregirOctavas(crudo);
  const filtrado = medianaMovil(suave, 2);
  return rellenarHuecos(filtrado, Math.round(0.03 / hopSeg + 1e-9));
}

/** Mediana de los valores sonoros en [i−k, i+k]. */
function medianaLocal(c: Contorno, i: number, k: number, excluirCentro: boolean): number | null {
  const v: number[] = [];
  for (let j = Math.max(0, i - k); j <= Math.min(c.length - 1, i + k); j++) {
    if (excluirCentro && j === i) continue;
    const m = c[j].midi;
    if (m !== null) v.push(m);
  }
  if (v.length === 0) return null;
  v.sort((p, q) => p - q);
  const h = v.length >> 1;
  return v.length % 2 ? v[h] : (v[h - 1] + v[h]) / 2;
}

/** Corrige saltos de octava aislados respecto a la mediana local (±7 frames). */
function corregirOctavas(c: Contorno): Contorno {
  return c.map((p, i) => {
    if (p.midi === null) return p;
    const med = medianaLocal(c, i, 7, true);
    if (med === null) return p;
    const dif = p.midi - med;
    if (Math.abs(Math.abs(dif) - 12) <= 1.5) return { ...p, midi: p.midi - 12 * Math.sign(dif) };
    return p;
  });
}

/** Filtro de mediana (2k+1 frames) solo sobre frames sonoros; los silencios se conservan. */
function medianaMovil(c: Contorno, k: number): Contorno {
  return c.map((p, i) => (p.midi === null ? p : { ...p, midi: medianaLocal(c, i, k, false) }));
}

/** Rellena huecos sin voz de ≤ maxFrames entre dos frames sonoros (vecino más cercano). */
function rellenarHuecos(c: Contorno, maxFrames: number): Contorno {
  const r = c.slice();
  let i = 0;
  while (i < r.length) {
    if (r[i].midi !== null) {
      i++;
      continue;
    }
    let j = i;
    while (j < r.length && r[j].midi === null) j++;
    const largo = j - i;
    if (i > 0 && j < r.length && largo <= maxFrames) {
      const izq = r[i - 1];
      const der = r[j];
      for (let k = i; k < j; k++) {
        const v = k - i < largo / 2 ? izq : der;
        r[k] = { t: r[k].t, midi: v.midi, claridad: Math.min(izq.claridad, der.claridad) };
      }
    }
    i = j;
  }
  return r;
}
