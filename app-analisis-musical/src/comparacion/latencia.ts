// Estimación automática de la latencia (modo sincronizado / karaoke).

import type { Contorno, Referencia } from "../tipos";
import { aRejilla, curvaReferencia, distanciaClase, PASO_REJILLA } from "./utilidades";

/** Frames con voz en ambos necesarios para fiarse de un desplazamiento (0,5 s). */
const SOLAPE_MINIMO = 50;
/** Cents de penalización por cada 100 % de frames voz-contra-silencio (desempate). */
const PENALIZACION_DESAJUSTE = 20;

/**
 * Milisegundos que el usuario va retrasado respecto a la referencia
 * (positivo = llega tarde; hay que restarlos a sus tiempos).
 * Prueba desplazamientos cada 10 ms en ±rangoMs y se queda con el de menor
 * error medio en cents (por clase de octava). Devuelve 0 si no hay datos.
 */
export function estimarLatencia(usuario: Contorno, ref: Referencia, rangoMs = 300): number {
  const paso = PASO_REJILLA;
  const r = curvaReferencia(ref, paso).midi;
  const u = aRejilla(usuario, paso).midi;
  const maxDesp = Math.round(rangoMs / 1000 / paso);

  let mejor = 0;
  let mejorCoste = Infinity;
  for (let d = -maxDesp; d <= maxDesp; d++) {
    let error = 0;
    let ambos = 0;
    let desajuste = 0;
    const kMin = Math.max(0, -d);
    const kMax = Math.min(r.length, u.length - d);
    for (let k = kMin; k < kMax; k++) {
      const vr = r[k];
      const vu = u[k + d];
      const hayR = !Number.isNaN(vr);
      const hayU = !Number.isNaN(vu);
      if (hayR && hayU) {
        error += distanciaClase(vu, vr) * 100;
        ambos++;
      } else if (hayR !== hayU) desajuste++;
    }
    if (ambos < SOLAPE_MINIMO) continue;
    const coste = error / ambos + (PENALIZACION_DESAJUSTE * desajuste) / (ambos + desajuste);
    // Ante empate, preferimos el desplazamiento más pequeño.
    if (coste < mejorCoste - 1e-9 || (Math.abs(coste - mejorCoste) <= 1e-9 && Math.abs(d) < Math.abs(mejor))) {
      mejorCoste = coste;
      mejor = d;
    }
  }
  return mejorCoste === Infinity ? 0 : Math.round(mejor * paso * 1000);
}
