// Web Worker (módulo ES): contorno YIN + segmentación en notas, fuera del hilo de la UI.
import type { Contorno, Nota } from "../tipos";
import { contornoDesdeAudio, OPCIONES_ACAPELLA, OPCIONES_CANCION } from "./yin";
import { segmentar, type OpcionesSegmentacion } from "./segmentar";

export interface PeticionAnalisis {
  id: string;
  muestras: Float32Array;
  sampleRate: number;
  tipo: "acapella" | "cancion";
}

export type RespuestaAnalisis =
  | { id: string; contorno: Contorno; notas: Nota[] }
  | { id: string; error: string }
  | { id: string; progreso: number };

/** Canción completa: notas mínimas más largas y cambios algo más marcados. */
const SEGMENTACION_CANCION: Partial<OpcionesSegmentacion> = { minDuracionSeg: 0.12, umbralCambioCents: 80 };

/** Analiza unas muestras mono (función pura, también usable fuera del worker). */
export function analizarMuestras(
  muestras: Float32Array,
  sampleRate: number,
  tipo: "acapella" | "cancion",
  onProgreso?: (p: number) => void,
): { contorno: Contorno; notas: Nota[] } {
  const opciones = tipo === "cancion" ? OPCIONES_CANCION : OPCIONES_ACAPELLA;
  const contorno = contornoDesdeAudio(muestras, sampleRate, opciones, onProgreso);
  const notas = segmentar(contorno, tipo === "cancion" ? SEGMENTACION_CANCION : undefined);
  return { contorno, notas };
}

// Solo se registra dentro de un worker (en tests se importa en node sin `self`).
const ambito = (typeof self !== "undefined" ? self : undefined) as DedicatedWorkerGlobalScope | undefined;
if (ambito && typeof ambito.postMessage === "function" && typeof window === "undefined") {
  ambito.onmessage = (ev: MessageEvent<PeticionAnalisis>) => {
    const { id, muestras, sampleRate, tipo } = ev.data;
    try {
      let ultimo = -1;
      const r = analizarMuestras(muestras, sampleRate, tipo, (p) => {
        // Como mucho ~50 mensajes de progreso.
        if (p - ultimo >= 0.02 || p === 1) {
          ultimo = p;
          ambito.postMessage({ id, progreso: p } satisfies RespuestaAnalisis);
        }
      });
      ambito.postMessage({ id, ...r } satisfies RespuestaAnalisis);
    } catch (e) {
      ambito.postMessage({ id, error: e instanceof Error ? e.message : String(e) } satisfies RespuestaAnalisis);
    }
  };
}
