// Análisis de una nota de referencia frente a los frames cantados.

import type { Contorno, Nota, ResultadoNota, Tolerancia } from "../tipos";
import { mediana, midiAHz } from "../notas";
import { detectarVibrato, quitarVibrato } from "../feedback/vibrato";
import { desviacion, distanciaClase, PASO_REJILLA, regresion } from "./utilidades";

/** Margen alrededor de la nota para detectar entradas/salidas (s). */
export const MARGEN_NOTA = 0.15;
/** Duraciones mínimas (s) para calcular cada métrica. */
export const DURACION_MIN_ESTABILIDAD = 0.25;
export const DURACION_MIN_VIBRATO = 0.6;
export const DURACION_MIN_DERIVA = 1;
/** Fracción mínima de frames con voz para no considerar la nota omitida. */
const COBERTURA_MINIMA = 0.3;
/** Un frame está "cerca" de la nota si su clase de octava dista ≤ 150 c. */
const CERCA_SEMITONOS = 1.5;
/** Ventana de ataque: ±30 c durante 3 frames seguidos. */
const ATAQUE_SEMITONOS = 0.3;
const FRAMES_ESTABLES = 3;
/** Scoop: los primeros frames más de 50 c por debajo. */
const SCOOP_SEMITONOS = 0.5;
/** Notas vecinas más cerca que esto (s) compiten por los frames del margen. */
const VECINDAD = 0.3;
const EPS = 1e-6;

interface Frame {
  t: number;
  m: number;
}

/** Serie uniforme (paso 10 ms) interpolando entre frames con voz cercanos. */
function serieUniforme(fr: Frame[], t0: number, t1: number, paso = PASO_REJILLA) {
  const ts: number[] = [];
  const vs: number[] = [];
  let j = 0;
  for (let t = t0; t <= t1 + EPS; t += paso) {
    while (j + 1 < fr.length && fr[j + 1].t <= t + EPS) j++;
    const a = fr[j];
    if (!a || a.t > t + EPS) continue;
    if (Math.abs(a.t - t) <= EPS) {
      ts.push(t);
      vs.push(a.m);
      continue;
    }
    const b = fr[j + 1];
    if (!b || b.t - a.t > 0.05) continue;
    const x = (t - a.t) / (b.t - a.t);
    ts.push(t);
    vs.push(a.m + x * (b.m - a.m));
  }
  return { ts, vs };
}

function omitida(ref: Nota): ResultadoNota {
  return {
    ref,
    desvioCents: 0,
    desvioHz: 0,
    pctFramesAfinados: 0,
    retrasoEntradaMs: 0,
    diferenciaFinMs: 0,
    estabilidadCents: 0,
    derivaCentsPorSeg: 0,
    ataqueMs: 0,
    scoop: false,
    estado: "omitida",
  };
}

/** Primer índice con t ≥ x (contorno ordenado por tiempo). */
function buscar(c: Contorno, x: number): number {
  let lo = 0;
  let hi = c.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (c[mid].t < x - EPS) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Calcula el ResultadoNota. `usuario` debe estar ya alineado al tiempo de la
 * referencia y corregido de octava/transposición, y ordenado por tiempo.
 */
export function analizarNota(
  ref: Nota,
  anterior: Nota | undefined,
  siguiente: Nota | undefined,
  usuario: Contorno,
  paso: number,
  tol: Tolerancia,
): ResultadoNota {
  const { inicio, fin } = ref;
  const dur = Math.max(fin - inicio, EPS);
  const ini = buscar(usuario, inicio - MARGEN_NOTA);
  const ventana: Frame[] = [];
  let totalEnNota = 0;
  for (let k = ini; k < usuario.length && usuario[k].t <= fin + MARGEN_NOTA + EPS; k++) {
    const p = usuario[k];
    if (p.t >= inicio - EPS && p.t < fin - EPS) totalEnNota++;
    if (p.midi != null && Number.isFinite(p.midi)) ventana.push({ t: p.t, m: p.midi });
  }
  const enNota = ventana.filter((f) => f.t >= inicio - EPS && f.t < fin - EPS);
  const esperados = Math.max(totalEnNota, Math.round(dur / paso), 1);
  if (enNota.length / esperados < COBERTURA_MINIMA) return omitida(ref);

  // --- Afinación ---
  const med = mediana(enNota.map((f) => f.m));
  const desvioCents = (med - ref.midi) * 100;
  const hzCantado = midiAHz(med);
  const afinados = enNota.filter((f) => Math.abs(f.m - ref.midi) * 100 <= tol.afinado).length;
  const pctFramesAfinados = (100 * afinados) / enNota.length;
  const absDesvio = Math.abs(desvioCents);
  const estado = absDesvio <= tol.afinado ? "afinada" : absDesvio <= tol.aceptable ? "aceptable" : "desafinada";

  // --- Entrada y salida ---
  const vecAnt = anterior && anterior.fin > inicio - VECINDAD ? anterior : undefined;
  const vecSig = siguiente && siguiente.inicio < fin + VECINDAD ? siguiente : undefined;
  const cerca = (f: Frame): boolean => {
    const d = distanciaClase(f.m, ref.midi);
    if (d > CERCA_SEMITONOS) return false;
    // En los márgenes, el frame debe parecerse más a esta nota que a la vecina.
    if (vecAnt && f.t < fin) {
      const dv = distanciaClase(f.m, vecAnt.midi);
      if (f.t < inicio - EPS ? d >= dv : d > dv) return false;
    }
    if (vecSig && f.t >= inicio) {
      const dv = distanciaClase(f.m, vecSig.midi);
      if (f.t >= fin - EPS ? d >= dv : d > dv) return false;
    }
    return true;
  };
  const previos = ventana.filter((f) => f.t < fin - EPS);
  const entrada = previos.find(cerca) ?? enNota[0];
  const posteriores = ventana.filter((f) => f.t >= inicio - EPS);
  let salida = enNota[enNota.length - 1];
  for (let k = posteriores.length - 1; k >= 0; k--) {
    if (cerca(posteriores[k])) {
      salida = posteriores[k];
      break;
    }
  }
  const retrasoEntradaMs = (entrada.t - inicio) * 1000;
  const diferenciaFinMs = (salida.t + paso - fin) * 1000;

  // --- Ataque y scoop ---
  // Objetivo: la nota de referencia, o lo cantado si el desvío es grande
  // (así un desvío constante se penaliza en afinación, no en ataque).
  const objetivo = absDesvio <= ATAQUE_SEMITONOS * 100 ? ref.midi : med;
  const tras = ventana.filter((f) => f.t >= entrada.t - EPS && f.t < fin - EPS);
  let asentado = -1;
  for (let k = 0; k < tras.length; k++) {
    let ok = true;
    for (let q = k; q < Math.min(tras.length, k + FRAMES_ESTABLES); q++) {
      if (Math.abs(tras[q].m - objetivo) > ATAQUE_SEMITONOS) {
        ok = false;
        break;
      }
    }
    if (ok) {
      asentado = k;
      break;
    }
  }
  const ataqueMs = asentado >= 0 ? (tras[asentado].t - entrada.t) * 1000 : Math.max(0, (fin - entrada.t) * 1000);
  const primeros = tras.slice(0, 3).map((f) => f.m);
  const scoop =
    asentado > 0 &&
    primeros.length > 0 &&
    primeros.reduce((a, b) => a + b, 0) / primeros.length < objetivo - SCOOP_SEMITONOS &&
    tras[asentado].m > primeros[0];

  // --- Parte sostenida: estabilidad, deriva y vibrato ---
  let estabilidadCents = 0;
  let derivaCentsPorSeg = 0;
  let vibrato: ResultadoNota["vibrato"];
  if (dur > DURACION_MIN_VIBRATO) {
    const larga = serieUniforme(enNota, inicio + 0.1 * dur, fin - 0.1 * dur);
    if (larga.vs.length > 10) {
      const { residuos } = regresion(larga.ts, larga.vs.map((v) => v * 100));
      vibrato = detectarVibrato(residuos, PASO_REJILLA);
    }
  }
  if (dur >= DURACION_MIN_ESTABILIDAD) {
    const central = serieUniforme(enNota, inicio + 0.2 * dur, fin - 0.2 * dur);
    if (central.vs.length >= 3) {
      const { pendiente, residuos } = regresion(central.ts, central.vs.map((v) => v * 100));
      const limpio = vibrato ? quitarVibrato(residuos, PASO_REJILLA, vibrato.hz) : residuos;
      estabilidadCents = desviacion(limpio);
      if (dur > DURACION_MIN_DERIVA) derivaCentsPorSeg = pendiente;
    }
  }

  return {
    ref,
    cantada: { midi: med, hz: hzCantado },
    desvioCents,
    desvioHz: hzCantado - ref.hz,
    pctFramesAfinados,
    retrasoEntradaMs,
    diferenciaFinMs,
    estabilidadCents,
    derivaCentsPorSeg,
    ataqueMs,
    scoop,
    ...(vibrato ? { vibrato } : {}),
    estado,
  };
}
