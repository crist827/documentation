// Apertura del micrófono sobre el AudioContext compartido.

import { obtenerContexto } from "./contexto";

export interface Microfono {
  ctx: AudioContext;
  stream: MediaStream;
  fuente: MediaStreamAudioSourceNode;
  /** Para las pistas y desconecta la fuente. No cierra el AudioContext compartido. */
  cerrar(): void;
}

export async function abrirMicrofono(): Promise<Microfono> {
  if (typeof window !== "undefined" && !window.isSecureContext) {
    throw new Error("El micrófono solo funciona con HTTPS (o en localhost). Abre la app desde una dirección https://.");
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("Este navegador no permite acceder al micrófono.");
  }

  // Primero el contexto, aún dentro del gesto del usuario (Safari/iOS no lo
  // reanuda si esperamos antes al diálogo de permiso).
  let ctx: AudioContext;
  try {
    ctx = await obtenerContexto();
  } catch (e) {
    throw new Error(`No se pudo iniciar el audio: ${(e as Error)?.message ?? e}`);
  }

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      // El procesado del navegador distorsiona el pitch: lo desactivamos todo
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
  } catch (e) {
    throw new Error(mensajeError(e));
  }

  const fuente = ctx.createMediaStreamSource(stream);
  let cerrado = false;
  return {
    ctx,
    stream,
    fuente,
    cerrar() {
      if (cerrado) return;
      cerrado = true;
      stream.getTracks().forEach((p) => p.stop());
      try {
        fuente.disconnect();
      } catch {
        // ya desconectada
      }
    },
  };
}

function mensajeError(e: unknown): string {
  const nombre = (e as DOMException)?.name;
  switch (nombre) {
    case "NotAllowedError":
    case "PermissionDeniedError":
    case "SecurityError":
      return "Permiso de micrófono denegado. Actívalo en la configuración del navegador (icono del candado junto a la dirección) y vuelve a intentarlo.";
    case "NotFoundError":
    case "DevicesNotFoundError":
    case "OverconstrainedError":
      return "No se encontró ningún micrófono. Conecta uno y vuelve a intentarlo.";
    case "NotReadableError":
    case "TrackStartError":
    case "AbortError":
      return "El micrófono está en uso por otra aplicación o no se pudo abrir.";
    default:
      return `No se pudo abrir el micrófono${(e as Error)?.message ? `: ${(e as Error).message}` : "."}`;
  }
}
