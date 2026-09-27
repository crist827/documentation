// Punto de entrada para la UI: analiza un archivo cargado y devuelve la Referencia.
import type { Contorno, Nota, Referencia } from "../tipos";
import { leerMidi, type InfoPista } from "./midi";
import { aMono, decodificarAudio } from "./decodificar";
import type { PeticionAnalisis, RespuestaAnalisis } from "./worker";

export type TipoDetectado = "midi" | "audio";

const EXT_MIDI = ["mid", "midi"];
const EXT_AUDIO = ["mp3", "wav", "ogg", "m4a", "flac", "webm", "aac"];
/** Frecuencia de análisis del audio. */
const SR_ANALISIS = 22050;

function extension(nombre: string): string {
  const i = nombre.lastIndexOf(".");
  return i < 0 ? "" : nombre.slice(i + 1).toLowerCase();
}

export function tipoDeArchivo(nombre: string): TipoDetectado | null {
  const ext = extension(nombre);
  if (EXT_MIDI.includes(ext)) return "midi";
  if (EXT_AUDIO.includes(ext)) return "audio";
  return null;
}

export interface ResultadoAnalisis {
  referencia: Referencia;
  /** AudioBuffer original decodificado (solo audios), para reproducirlo. */
  audio?: AudioBuffer;
  /** Pistas melódicas del MIDI (solo MIDI), para que el usuario pueda cambiar de pista. */
  pistas?: InfoPista[];
  /** Índice de la pista MIDI analizada (elegida automáticamente o por el usuario). */
  pistaElegida?: number;
}

function nombreSinExtension(nombre: string): string {
  const i = nombre.lastIndexOf(".");
  return i > 0 ? nombre.slice(0, i) : nombre;
}

function nuevoId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `ref-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** Ejecuta el análisis en un Web Worker. */
function analizarEnWorker(
  muestras: Float32Array,
  tipo: "acapella" | "cancion",
  onProgreso?: (p: number) => void,
): Promise<{ contorno: Contorno; notas: Nota[] }> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
    const id = nuevoId();
    worker.onmessage = (ev: MessageEvent<RespuestaAnalisis>) => {
      const r = ev.data;
      if (r.id !== id) return;
      if ("progreso" in r) {
        onProgreso?.(r.progreso);
        return;
      }
      worker.terminate();
      if ("error" in r) reject(new Error(`Error al analizar el audio: ${r.error}`));
      else resolve(r);
    };
    worker.onerror = (ev) => {
      worker.terminate();
      reject(new Error(`Error en el analizador de audio: ${ev.message || "desconocido"}`));
    };
    const msg: PeticionAnalisis = { id, muestras, sampleRate: SR_ANALISIS, tipo };
    worker.postMessage(msg, [muestras.buffer]);
  });
}

export async function analizarArchivo(
  archivo: File,
  opciones?: { tipoAudio?: "acapella" | "cancion"; pista?: number; onProgreso?: (p: number) => void },
): Promise<ResultadoAnalisis> {
  const tipoArchivo = tipoDeArchivo(archivo.name);
  if (!tipoArchivo) {
    throw new Error(
      `Formato no soportado (“${archivo.name}”). Usa MIDI (.mid, .midi) o audio (${EXT_AUDIO.map((e) => "." + e).join(", ")}).`,
    );
  }
  const progreso = opciones?.onProgreso;
  const nombre = nombreSinExtension(archivo.name);
  progreso?.(0);
  const datos = await archivo.arrayBuffer();

  if (tipoArchivo === "midi") {
    const r = leerMidi(datos, opciones?.pista);
    if (r.notas.length === 0) throw new Error("La pista elegida del MIDI no tiene notas.");
    progreso?.(1);
    return {
      referencia: { id: nuevoId(), nombre, tipo: "midi", duracion: r.duracion, notas: r.notas },
      pistas: r.pistas,
      pistaElegida: r.pistaElegida,
    };
  }

  const tipo = opciones?.tipoAudio ?? "acapella";
  const audio = await decodificarAudio(datos);
  if (audio.duration < 0.2) throw new Error("El audio es demasiado corto para analizarlo.");
  progreso?.(0.1);
  const mono = await aMono(audio, SR_ANALISIS);
  progreso?.(0.2);
  const { contorno, notas } = await analizarEnWorker(mono, tipo, (p) => progreso?.(0.2 + 0.8 * p));
  if (notas.length === 0) {
    throw new Error(
      tipo === "cancion"
        ? "No se detectó una melodía vocal clara en la canción. Prueba a separar la voz (Demucs) y cargar vocals.wav como a cappella."
        : "No se detectó voz en el audio. Comprueba que contiene una voz cantada audible.",
    );
  }
  progreso?.(1);
  return {
    referencia: { id: nuevoId(), nombre, tipo, duracion: audio.duration, notas, contorno },
    audio,
  };
}
