// Puntuación global 0–100: 50 % afinación, 20 % estabilidad, 20 % ritmo, 10 % ataques.

import type { Metricas, Nivel } from "../tipos";
import { TOLERANCIAS } from "../tipos";

/** 100 si x ≤ bueno, baja linealmente hasta 0 en x ≥ malo. */
function curva(x: number, bueno: number, malo: number): number {
  if (!Number.isFinite(x)) return 0;
  if (x <= bueno) return 100;
  if (x >= malo) return 0;
  return (100 * (malo - x)) / (malo - bueno);
}

export function puntuar(
  m: Metricas,
  nivel: Nivel,
): { puntuacion: number; desglose: { afinacion: number; estabilidad: number; ritmo: number; ataques: number } } {
  const tol = TOLERANCIAS[nivel];
  // Lo que no se canta no se puede puntuar: las omisiones escalan todo,
  // y en afinación penalizan además el doble.
  const cobertura = Math.max(0, 1 - m.pctNotasOmitidas / 100);

  // Mitad error medio, mitad % de notas cantadas que quedan afinadas: así una
  // nota muy desafinada no queda escondida en la media.
  const precision = cobertura > 0 ? Math.min(100, m.pctNotasAfinadas / cobertura) : 0;
  const afinacion =
    (0.5 * curva(m.errorMedioCents, tol.afinado, 3 * tol.aceptable) + 0.5 * precision) *
    Math.max(0, 1 - (2 * m.pctNotasOmitidas) / 100);

  const estabilidad =
    (0.7 * curva(m.estabilidadCents, 15, 60) + 0.3 * curva(Math.abs(m.derivaCentsPorSeg), 20, 80)) * cobertura;

  const dur = m.duracionRelativa;
  const desvDur = dur < 0.9 ? 0.9 - dur : dur > 1.05 ? dur - 1.05 : 0;
  const ritmo =
    ((curva(Math.abs(m.retrasoEntradaMedioMs), 60, 300) +
      curva(m.dispersionEntradaMs, 60, 300) +
      curva(desvDur, 0, 0.4)) /
      3) *
    cobertura;

  const ataques = (0.6 * curva(m.ataqueMedioMs, 100, 400) + 0.4 * curva(m.pctScoop, 20, 100)) * cobertura;

  const total = 0.5 * afinacion + 0.2 * estabilidad + 0.2 * ritmo + 0.1 * ataques;
  return {
    puntuacion: Math.round(total),
    desglose: {
      afinacion: Math.round(afinacion),
      estabilidad: Math.round(estabilidad),
      ritmo: Math.round(ritmo),
      ataques: Math.round(ataques),
    },
  };
}
