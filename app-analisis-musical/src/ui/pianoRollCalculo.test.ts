import { describe, expect, it } from "vitest";
import { duracionTotal, esTeclaNegra, etiquetaTiempo, indiceDesde, pasoMarcas, rangoMidi } from "./pianoRollCalculo";

describe("rangoMidi", () => {
  it("valores por defecto sin datos", () => {
    const [a, b] = rangoMidi([], []);
    expect(b - a).toBeGreaterThanOrEqual(12);
  });
  it("incluye notas y contorno con margen", () => {
    const r = rangoMidi(
      [{ inicio: 0, fin: 1, midi: 60, hz: 0 }],
      [[{ t: 0, midi: 79.4, claridad: 1 }, { t: 1, midi: null, claridad: 0 }]],
    );
    expect(r).toEqual([58, 82]);
  });
  it("amplía hasta el mínimo de semitonos", () => {
    const [a, b] = rangoMidi([{ inicio: 0, fin: 1, midi: 64, hz: 0 }], []);
    expect(b - a).toBe(12);
    expect(a).toBeLessThanOrEqual(62);
    expect(b).toBeGreaterThanOrEqual(66);
  });
});

describe("pasoMarcas", () => {
  it("elige un paso legible", () => {
    expect(pasoMarcas(10, 700)).toBe(1);
    expect(pasoMarcas(200, 700)).toBe(30);
  });
});

describe("indiceDesde", () => {
  const c = [0, 1, 2, 3].map((t) => ({ t, midi: 60, claridad: 1 }));
  it("búsqueda binaria", () => {
    expect(indiceDesde(c, -1)).toBe(0);
    expect(indiceDesde(c, 1.5)).toBe(2);
    expect(indiceDesde(c, 9)).toBe(4);
  });
});

describe("otros", () => {
  it("etiquetaTiempo", () => {
    expect(etiquetaTiempo(5)).toBe("5 s");
    expect(etiquetaTiempo(0.5)).toBe("0.5 s");
    expect(etiquetaTiempo(65)).toBe("1:05");
  });
  it("esTeclaNegra", () => {
    expect(esTeclaNegra(61)).toBe(true);
    expect(esTeclaNegra(60)).toBe(false);
  });
  it("duracionTotal", () => {
    expect(duracionTotal([{ inicio: 0, fin: 3, midi: 60, hz: 0 }], [[{ t: 4, midi: null, claridad: 0 }]])).toBe(4);
  });
});
