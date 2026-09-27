// Métricas globales de una interpretación (DISENO §4.1).

import type { Metricas, ResultadoNota } from "../tipos";
import { desviacion, limitar, media } from "../comparacion/utilidades";
import { DURACION_MIN_DERIVA, DURACION_MIN_ESTABILIDAD } from "../comparacion/nota";

/** Intervalo (semitonos) a partir del cual se considera salto. */
const SALTO = 4;
/** Intervalo máximo (semitonos) de un grado conjunto. */
const GRADO_CONJUNTO = 2;

const duracion = (r: ResultadoNota) => r.ref.fin - r.ref.inicio;

export function calcularMetricas(resultados: ResultadoNota[]): Metricas {
  const total = resultados.length;
  const cantadas = resultados.filter((r) => r.estado !== "omitida");
  const pct = (x: number) => (total > 0 ? (100 * x) / total : 0);

  const desvios = cantadas.map((r) => r.desvioCents);
  const estables = cantadas.filter((r) => duracion(r) >= DURACION_MIN_ESTABILIDAD);
  const largas = cantadas.filter((r) => duracion(r) > DURACION_MIN_DERIVA);
  const entradas = cantadas.map((r) => r.retrasoEntradaMs);

  // Duración cantada / duración de referencia, nota a nota.
  const duraciones = cantadas.map((r) => {
    const d = duracion(r);
    if (d <= 0) return 1;
    const cantada = d + (r.diferenciaFinMs - r.retrasoEntradaMs) / 1000;
    return limitar(cantada / d, 0, 2);
  });

  // Intervalos entre notas consecutivas cantadas.
  const errSaltos: number[] = [];
  const errGrados: number[] = [];
  for (let i = 1; i < resultados.length; i++) {
    const a = resultados[i - 1];
    const b = resultados[i];
    if (!a.cantada || !b.cantada || a.estado === "omitida" || b.estado === "omitida") continue;
    const intRef = b.ref.midi - a.ref.midi;
    const error = Math.abs(b.cantada.midi - a.cantada.midi - intRef) * 100;
    if (Math.abs(intRef) >= SALTO) errSaltos.push(error);
    else if (Math.abs(intRef) <= GRADO_CONJUNTO) errGrados.push(error);
  }

  // Registro: tercios de la tesitura de la referencia.
  const alturas = resultados.map((r) => r.ref.midi);
  const min = alturas.length ? Math.min(...alturas) : 0;
  const max = alturas.length ? Math.max(...alturas) : 0;
  const tercio = (max - min) / 3;
  const zonas = { grave: [] as number[], medio: [] as number[], agudo: [] as number[] };
  for (const r of cantadas) {
    const m = r.ref.midi;
    const zona = tercio <= 0 ? "medio" : m < min + tercio ? "grave" : m > max - tercio ? "agudo" : "medio";
    zonas[zona].push(Math.abs(r.desvioCents));
  }

  const conVibrato = cantadas.filter((r) => r.vibrato);
  const metricas: Metricas = {
    errorMedioCents: media(desvios.map(Math.abs)),
    sesgoCents: media(desvios),
    pctNotasAfinadas: pct(resultados.filter((r) => r.estado === "afinada").length),
    pctNotasOmitidas: pct(total - cantadas.length),
    estabilidadCents: media(estables.map((r) => r.estabilidadCents)),
    derivaCentsPorSeg: media(largas.map((r) => r.derivaCentsPorSeg)),
    pctScoop: cantadas.length ? (100 * cantadas.filter((r) => r.scoop).length) / cantadas.length : 0,
    ataqueMedioMs: media(cantadas.map((r) => r.ataqueMs)),
    retrasoEntradaMedioMs: media(entradas),
    dispersionEntradaMs: desviacion(entradas),
    duracionRelativa: media(duraciones),
    errorSaltosCents: media(errSaltos),
    errorGradosConjuntosCents: media(errGrados),
    errorPorRegistro: { grave: media(zonas.grave), medio: media(zonas.medio), agudo: media(zonas.agudo) },
  };
  if (conVibrato.length) {
    metricas.vibratoMedio = {
      hz: media(conVibrato.map((r) => r.vibrato!.hz)),
      amplitudCents: media(conVibrato.map((r) => r.vibrato!.amplitudCents)),
    };
  }
  return metricas;
}
