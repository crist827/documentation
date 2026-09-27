// Detector de pitch para voz en tiempo real (McLeod/MPM vía pitchy).
// Puro: no toca el DOM ni Web Audio, así se puede probar con señales sintéticas.

import { PitchDetector } from "pitchy";
import { hzAMidi, midiAHz } from "../notas";

export interface OpcionesDetector {
  /** Rango válido de f0 (Hz). */
  minHz: number;
  maxHz: number;
  /** Claridad MPM mínima (0..1) para considerar que hay voz. */
  claridadMin: number;
  /** Puerta de volumen: por debajo de este RMS (dBFS) se considera silencio. */
  rmsMinDb: number;
  /** Nº de lecturas válidas sobre las que se calcula la mediana. */
  ventanaMediana: number;
}

export const OPCIONES_DETECTOR: OpcionesDetector = {
  minHz: 70,
  maxHz: 1100,
  claridadMin: 0.9,
  rmsMinDb: -45,
  ventanaMediana: 5,
};

export interface LecturaPitch {
  /** f0 suavizada (Hz); null = silencio/ruido. */
  hz: number | null;
  /** Nota MIDI con decimales (suavizada); null = silencio/ruido. */
  midi: number | null;
  /** Claridad cruda del frame (0 si no pasó la puerta de volumen). */
  claridad: number;
  rmsDb: number;
}

/** Lecturas nulas seguidas tras las que se olvida el historial de la mediana. */
const NULOS_PARA_REINICIAR = 3;

export class DetectorVoz {
  readonly tamano: number;
  private readonly sampleRate: number;
  private readonly op: OpcionesDetector;
  private readonly pitchy: PitchDetector<Float32Array>;
  private historial: number[] = [];
  private nulosSeguidos = 0;
  private ultimaSuave: number | null = null;

  constructor(sampleRate: number, tamano = 2048, opciones: Partial<OpcionesDetector> = {}) {
    this.sampleRate = sampleRate;
    this.tamano = tamano;
    this.op = { ...OPCIONES_DETECTOR, ...opciones };
    this.pitchy = PitchDetector.forFloat32Array(tamano);
  }

  procesar(buffer: Float32Array): LecturaPitch {
    // pitchy exige exactamente `tamano` muestras: usamos las más recientes
    const b = buffer.length === this.tamano ? buffer : buffer.subarray(Math.max(0, buffer.length - this.tamano));
    if (b.length < this.tamano) return this.nulo(0, -Infinity);

    const rmsDb = calcularRmsDb(b);
    if (rmsDb < this.op.rmsMinDb) return this.nulo(0, rmsDb);

    const [hz, claridad] = this.pitchy.findPitch(b, this.sampleRate);
    if (!(claridad >= this.op.claridadMin) || !(hz >= this.op.minHz && hz <= this.op.maxHz)) {
      return this.nulo(claridad || 0, rmsDb);
    }

    const midi = hzAMidi(hz);
    this.nulosSeguidos = 0;
    this.historial.push(midi);
    if (this.historial.length > this.op.ventanaMediana) this.historial.shift();
    const suave = medianaCercana(this.historial, this.ultimaSuave ?? midi);
    this.ultimaSuave = suave;
    return { hz: midiAHz(suave), midi: suave, claridad, rmsDb };
  }

  reiniciar(): void {
    this.historial = [];
    this.nulosSeguidos = 0;
    this.ultimaSuave = null;
  }

  private nulo(claridad: number, rmsDb: number): LecturaPitch {
    if (++this.nulosSeguidos >= NULOS_PARA_REINICIAR) {
      this.historial = [];
      this.ultimaSuave = null;
    }
    return { hz: null, midi: null, claridad, rmsDb };
  }
}

export function calcularRmsDb(b: Float32Array): number {
  let s = 0;
  for (let i = 0; i < b.length; i++) s += b[i] * b[i];
  const rms = Math.sqrt(s / b.length);
  return rms > 0 ? 20 * Math.log10(rms) : -Infinity;
}

/**
 * Mediana que nunca promedia: con un número par de valores elige, de los dos
 * centrales, el más cercano a la salida anterior (promediar un salto de octava
 * daría una nota inexistente a medio camino).
 */
function medianaCercana(valores: number[], previa: number): number {
  const v = [...valores].sort((a, b) => a - b);
  const m = v.length >> 1;
  if (v.length % 2) return v[m];
  return Math.abs(v[m - 1] - previa) <= Math.abs(v[m] - previa) ? v[m - 1] : v[m];
}
