// Segmentación de un contorno de pitch en notas discretas (DISENO.md §2.3).
import type { Contorno, Nota } from "../tipos";
import { mediana, midiAHz } from "../notas";

export interface OpcionesSegmentacion {
  /** Desvío (cents) respecto a la mediana de la nota actual que abre una nota nueva. */
  umbralCambioCents: number;
  /** Tiempo (s) que debe mantenerse el desvío para abrir nota nueva. */
  minCambioSeg: number;
  /** Notas más cortas (s) se descartan. */
  minDuracionSeg: number;
}

export const OPCIONES_SEGMENTACION: OpcionesSegmentacion = {
  umbralCambioCents: 70,
  minCambioSeg: 0.05,
  minDuracionSeg: 0.09,
};

/** Fusión legato: notas casi iguales separadas por huecos cortos. */
const FUSION_MAX_CENTS = 40;
const FUSION_MAX_HUECO = 0.06;
/** La mediana de referencia de la nota en curso usa como mucho los últimos N frames. */
const MAX_FRAMES_REF = 60;

interface Tramo {
  /** Tiempos y alturas de los frames de la nota. */
  t: number[];
  m: number[];
}

/** Pitch de la nota = mediana del 60 % central (sin ataque ni caída). */
function pitchCentral(m: number[]): number {
  const n = m.length;
  const a = Math.floor(n * 0.2);
  const b = Math.max(a + 1, Math.ceil(n * 0.8));
  return mediana(m.slice(a, b));
}

/** Hop medio del contorno (s). */
function estimarHop(c: Contorno): number {
  if (c.length < 2) return 0.01;
  return (c[c.length - 1].t - c[0].t) / (c.length - 1);
}

export function segmentar(contorno: Contorno, opciones?: Partial<OpcionesSegmentacion>): Nota[] {
  const op = { ...OPCIONES_SEGMENTACION, ...opciones };
  const hop = estimarHop(contorno);
  const umbral = op.umbralCambioCents / 100;

  const tramos: Tramo[] = [];
  let actual: Tramo | null = null;
  let pendiente: Tramo | null = null; // frames que se alejan de la nota actual

  const cerrar = () => {
    if (actual) {
      if (pendiente) {
        actual.t.push(...pendiente.t);
        actual.m.push(...pendiente.m);
      }
      tramos.push(actual);
    }
    actual = null;
    pendiente = null;
  };

  for (const p of contorno) {
    if (p.midi === null) {
      cerrar(); // silencio → fin de nota
      continue;
    }
    if (!actual) {
      actual = { t: [p.t], m: [p.midi] };
      continue;
    }
    const a: Tramo = actual;
    const ref = mediana(a.m.slice(-MAX_FRAMES_REF));
    if (Math.abs(p.midi - ref) > umbral) {
      if (!pendiente) pendiente = { t: [], m: [] };
      pendiente.t.push(p.t);
      pendiente.m.push(p.midi);
      // Desvío sostenido: la nota nueva empieza donde empezó el desvío.
      if (pendiente.t[pendiente.t.length - 1] - pendiente.t[0] + hop > op.minCambioSeg) {
        tramos.push(a);
        actual = pendiente;
        pendiente = null;
      }
    } else {
      // El desvío no se mantuvo: era parte de la nota (vibrato, ornamento).
      if (pendiente) {
        a.t.push(...pendiente.t);
        a.m.push(...pendiente.m);
        pendiente = null;
      }
      a.t.push(p.t);
      a.m.push(p.midi);
    }
  }
  cerrar();

  // Notas con inicio/fin en los bordes de sus frames; descarta las cortas.
  const notas: (Nota & { frames: number[] })[] = [];
  for (const tr of tramos) {
    const inicio = tr.t[0] - hop / 2;
    const fin = tr.t[tr.t.length - 1] + hop / 2;
    if (fin - inicio < op.minDuracionSeg) continue;
    const midi = pitchCentral(tr.m);
    notas.push({ inicio, fin, midi, hz: midiAHz(midi), frames: tr.m });
  }

  // Fusión legato de notas consecutivas casi iguales.
  const fusionadas: (Nota & { frames: number[] })[] = [];
  for (const n of notas) {
    const ult = fusionadas[fusionadas.length - 1];
    if (
      ult &&
      n.inicio - ult.fin < FUSION_MAX_HUECO + 1e-9 &&
      Math.abs(n.midi - ult.midi) * 100 < FUSION_MAX_CENTS
    ) {
      ult.fin = n.fin;
      ult.frames = ult.frames.concat(n.frames);
      ult.midi = pitchCentral(ult.frames);
      ult.hz = midiAHz(ult.midi);
    } else {
      fusionadas.push({ ...n });
    }
  }
  return fusionadas.map(({ inicio, fin, midi, hz }) => ({ inicio, fin, midi, hz }));
}
