// Pipeline completo: alineación → octava/transposición → notas → feedback.

import type { Contorno, Informe, OpcionesComparacion, Referencia, ResultadoNota } from "../tipos";
import { TOLERANCIAS } from "../tipos";
import { calcularMetricas } from "../feedback/metricas";
import { generarConsejos } from "../feedback/reglas";
import { puntuar } from "../feedback/puntuacion";
import { alinearDTW } from "./dtw";
import { estimarLatencia } from "./latencia";
import { analizarNota } from "./nota";
import { estimarOctava } from "./octava";
import { pasoContorno } from "./utilidades";

function desplazarAltura(c: Contorno, semitonos: number): Contorno {
  if (semitonos === 0) return c;
  return c.map((p) => (p.midi == null ? p : { ...p, midi: p.midi - semitonos }));
}

export function comparar(ref: Referencia, usuario: Contorno, opciones: OpcionesComparacion): Informe {
  const tol = TOLERANCIAS[opciones.nivel];
  const ordenado = [...usuario].sort((a, b) => a.t - b.t);

  // La transposición solo afecta a la altura, así que se aplica antes de
  // alinear: mejora la estimación de latencia y el DTW.
  const transpuesto = desplazarAltura(ordenado, opciones.transposicion || 0);

  // 1) Alineación temporal.
  let latenciaMs = 0;
  let alineado: Contorno;
  if (opciones.modo === "libre") {
    alineado = alinearDTW(transpuesto, ref);
  } else {
    latenciaMs = opciones.latenciaMs ?? estimarLatencia(transpuesto, ref);
    const d = latenciaMs / 1000;
    alineado = transpuesto.map((p) => ({ ...p, t: p.t - d }));
  }

  // 2) Octava dominante.
  const desplazamientoOctava = opciones.corregirOctava ? estimarOctava(alineado, ref) : 0;
  const final = desplazarAltura(alineado, desplazamientoOctava * 12);

  // 3) Resultados por nota.
  const paso = pasoContorno(final);
  const notas = [...ref.notas].sort((a, b) => a.inicio - b.inicio);
  const resultados: ResultadoNota[] = notas.map((n, i) =>
    analizarNota(n, notas[i - 1], notas[i + 1], final, paso, tol),
  );

  // 4) Métricas, consejos y puntuación.
  const metricas = calcularMetricas(resultados);
  const consejos = generarConsejos(metricas);
  const { puntuacion, desglose } = puntuar(metricas, opciones.nivel);

  return {
    fecha: Date.now(),
    referenciaId: ref.id,
    referenciaNombre: ref.nombre,
    opciones,
    latenciaMs,
    desplazamientoOctava,
    resultados,
    metricas,
    consejos,
    puntuacion,
    desglose,
    contornoUsuario: final,
  };
}
