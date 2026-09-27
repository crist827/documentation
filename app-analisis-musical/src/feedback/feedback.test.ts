import { describe, expect, it } from "vitest";
import type { Metricas, ResultadoNota } from "../tipos";
import { nota } from "../comparacion/sinteticos";
import { calcularMetricas } from "./metricas";
import { generarConsejos } from "./reglas";
import { puntuar } from "./puntuacion";
import { detectarVibrato, quitarVibrato } from "./vibrato";
import { desviacion } from "../comparacion/utilidades";

function resultado(midiRef: number, desvio: number, extra: Partial<ResultadoNota> = {}, inicio = 0, dur = 0.5): ResultadoNota {
  const ref = nota(midiRef, inicio, inicio + dur);
  return {
    ref,
    cantada: { midi: midiRef + desvio / 100, hz: 0 },
    desvioCents: desvio,
    desvioHz: 0,
    pctFramesAfinados: 100,
    retrasoEntradaMs: 0,
    diferenciaFinMs: 0,
    estabilidadCents: 5,
    derivaCentsPorSeg: 0,
    ataqueMs: 20,
    scoop: false,
    estado: Math.abs(desvio) <= 25 ? "afinada" : Math.abs(desvio) <= 50 ? "aceptable" : "desafinada",
    ...extra,
  };
}

const BASE: Metricas = calcularMetricas([resultado(60, 0), resultado(64, 0), resultado(67, 0)]);

describe("calcularMetricas", () => {
  it("lista vacía → ceros, sin NaN", () => {
    const m = calcularMetricas([]);
    for (const v of Object.values(m)) {
      if (typeof v === "number") expect(v).toBe(0);
    }
    expect(m.errorPorRegistro).toEqual({ grave: 0, medio: 0, agudo: 0 });
    expect(m.vibratoMedio).toBeUndefined();
  });

  it("excluye omitidas de la afinación pero las cuenta", () => {
    const m = calcularMetricas([
      resultado(60, -30),
      resultado(62, 10),
      resultado(64, 0, { estado: "omitida", desvioCents: 0, cantada: undefined }),
      resultado(65, 0),
    ]);
    expect(m.errorMedioCents).toBeCloseTo(40 / 3);
    expect(m.sesgoCents).toBeCloseTo(-20 / 3);
    expect(m.pctNotasOmitidas).toBe(25);
    expect(m.pctNotasAfinadas).toBe(50);
  });

  it("separa saltos de grados conjuntos y calcula el registro", () => {
    // 60→62 (grado), 62→69 (salto de 7), 69→71 (grado).
    const m = calcularMetricas([resultado(60, 0), resultado(62, 0), resultado(69, 40), resultado(71, 40)]);
    expect(m.errorSaltosCents).toBeCloseTo(40);
    expect(m.errorGradosConjuntosCents).toBeCloseTo(0);
    expect(m.errorPorRegistro.agudo).toBeCloseTo(40);
    expect(m.errorPorRegistro.grave).toBeCloseTo(0);
  });

  it("entradas, duración relativa y vibrato medio", () => {
    const m = calcularMetricas([
      resultado(60, 0, { retrasoEntradaMs: 100, diferenciaFinMs: -100, vibrato: { hz: 5, amplitudCents: 40 } }),
      resultado(62, 0, { retrasoEntradaMs: 0, diferenciaFinMs: 0, vibrato: { hz: 6, amplitudCents: 60 } }),
    ]);
    expect(m.retrasoEntradaMedioMs).toBe(50);
    expect(m.dispersionEntradaMs).toBe(50);
    expect(m.duracionRelativa).toBeCloseTo((0.6 + 1) / 2);
    expect(m.vibratoMedio).toEqual({ hz: 5.5, amplitudCents: 50 });
  });
});

describe("generarConsejos", () => {
  it("todo bien → mensaje positivo", () => {
    const c = generarConsejos(BASE);
    expect(c).toHaveLength(1);
    expect(c[0].id).toBe("bien");
  });

  it("ordena por gravedad y respeta el máximo", () => {
    const m: Metricas = {
      ...BASE,
      sesgoCents: -45,
      errorMedioCents: 45,
      estabilidadCents: 30,
      retrasoEntradaMedioMs: 90,
      duracionRelativa: 0.7,
      pctScoop: 50,
    };
    const c = generarConsejos(m);
    expect(c).toHaveLength(3);
    expect(c[0].id).toBe("calado");
    for (let i = 1; i < c.length; i++) expect(c[i - 1].gravedad).toBeGreaterThanOrEqual(c[i].gravedad);
    expect(generarConsejos(m, 10).length).toBeGreaterThan(3);
  });

  it("la gravedad crece con el exceso", () => {
    const leve = generarConsejos({ ...BASE, sesgoCents: 20 })[0];
    const fuerte = generarConsejos({ ...BASE, sesgoCents: 60 })[0];
    expect(leve.id).toBe("sostenido");
    expect(fuerte.gravedad).toBeGreaterThan(leve.gravedad);
  });

  it("reglas de saltos, agudo, omisiones y vibrato", () => {
    const ids = (m: Partial<Metricas>) => generarConsejos({ ...BASE, ...m }, 20).map((c) => c.id);
    expect(ids({ errorSaltosCents: 60, errorGradosConjuntosCents: 10 })).toContain("saltos");
    expect(ids({ errorPorRegistro: { grave: 5, medio: 10, agudo: 45 } })).toContain("agudo");
    expect(ids({ pctNotasOmitidas: 50 })).toContain("omisiones");
    expect(ids({ vibratoMedio: { hz: 8, amplitudCents: 40 } })).toContain("vibrato-rapido");
    expect(ids({ vibratoMedio: { hz: 4, amplitudCents: 40 } })).toContain("vibrato-lento");
    expect(ids({ vibratoMedio: { hz: 5.5, amplitudCents: 120 } })).toContain("vibrato-amplio");
    expect(ids({ derivaCentsPorSeg: -35 })).toContain("se-caen");
    const agudoCalado = generarConsejos({ ...BASE, sesgoCents: -30, errorPorRegistro: { grave: 10, medio: 10, agudo: 50 } })[0];
    expect(agudoCalado.mensaje).toContain("agudo");
  });
});

describe("puntuar", () => {
  it("perfecto → 100; peor afinación → menos puntos", () => {
    expect(puntuar(BASE, "intermedio").puntuacion).toBe(100);
    const medio = puntuar({ ...BASE, errorMedioCents: 60 }, "intermedio");
    expect(medio.desglose.afinacion).toBeGreaterThan(0);
    expect(medio.desglose.afinacion).toBeLessThan(100);
    expect(puntuar({ ...BASE, errorMedioCents: 200 }, "intermedio").desglose.afinacion).toBe(0);
  });

  it("depende del nivel", () => {
    const m = { ...BASE, errorMedioCents: 40 };
    expect(puntuar(m, "principiante").desglose.afinacion).toBe(100);
    expect(puntuar(m, "avanzado").desglose.afinacion).toBeLessThan(puntuar(m, "intermedio").desglose.afinacion);
  });

  it("las omisiones penalizan", () => {
    const p = puntuar({ ...BASE, pctNotasOmitidas: 30 }, "intermedio");
    expect(p.desglose.afinacion).toBeLessThan(100);
    expect(puntuar({ ...calcularMetricas([]), pctNotasOmitidas: 100 }, "intermedio").puntuacion).toBe(0);
  });
});

describe("vibrato", () => {
  it("detecta 5,5 Hz ±50 c y lo elimina con la media móvil", () => {
    const serie = Array.from({ length: 150 }, (_, i) => 50 * Math.sin(2 * Math.PI * 5.5 * i * 0.01));
    const v = detectarVibrato(serie, 0.01)!;
    expect(v.hz).toBeCloseTo(5.5, 0);
    expect(v.amplitudCents).toBeCloseTo(50, -1);
    expect(desviacion(quitarVibrato(serie, 0.01, v.hz))).toBeLessThan(5);
  });

  it("ruido o línea plana → sin vibrato", () => {
    expect(detectarVibrato(new Array(150).fill(0), 0.01)).toBeUndefined();
    let s = 1;
    const ruido = Array.from({ length: 150 }, () => ((s = (s * 16807) % 2147483647) / 2147483647 - 0.5) * 20);
    expect(detectarVibrato(ruido, 0.01)).toBeUndefined();
  });
});
