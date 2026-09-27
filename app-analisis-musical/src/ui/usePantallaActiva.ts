import { useEffect } from "react";

// Mantiene la pantalla encendida mientras `activa` sea true (Screen Wake Lock API).
// En el móvil evita que se apague a mitad de una canción. Sin soporte, no hace nada.
export function usePantallaActiva(activa: boolean): void {
  useEffect(() => {
    if (!activa || !("wakeLock" in navigator)) return;
    let bloqueo: WakeLockSentinel | null = null;
    let cancelado = false;

    const pedir = () => {
      navigator.wakeLock
        .request("screen")
        .then((b) => {
          if (cancelado) void b.release();
          else bloqueo = b;
        })
        .catch(() => {});
    };
    // el bloqueo se pierde al cambiar de pestaña: se vuelve a pedir al regresar
    const alVolver = () => document.visibilityState === "visible" && pedir();

    pedir();
    document.addEventListener("visibilitychange", alVolver);
    return () => {
      cancelado = true;
      document.removeEventListener("visibilitychange", alVolver);
      void bloqueo?.release();
    };
  }, [activa]);
}
