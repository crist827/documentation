import { describe, expect, it } from "vitest";
import type { Nota, Referencia } from "../tipos";
import {
  desplazarContorno,
  duracionReferencia,
  normalizarFragmento,
  notaEn,
  octavaEnVivo,
  recortarReferencia,
} from "./fragmento";

const nota = (inicio: number, fin: number, midi = 60): Nota => ({ inicio, fin, midi, hz: 261.63 });

const ref: Referencia = {
  id: "r",
  nombre: "prueba",
  tipo: "midi",
  duracion: 10,
  notas: [nota(0, 1), nota(1, 2.5, 62), nota(3, 4, 64), nota(6, 9, 65)],
  contorno: [0, 2, 4, 6, 8].map((t) => ({ t, midi: 60, claridad: 1 })),
};

describe("normalizarFragmento", () => {
  it("devuelve null si cubre toda la canción o es demasiado corto", () => {
    expect(normalizarFragmento(null, null, 10)).toBeNull();
    expect(normalizarFragmento(0, 10, 10)).toBeNull();
    expect(normalizarFragmento(3, 3.2, 10)).toBeNull();
  });
  it("limita a la duración", () => {
    expect(normalizarFragmento(2, 50, 10)).toEqual({ inicio: 2, fin: 10 });
    expect(normalizarFragmento(-1, 4, 10)).toEqual({ inicio: 0, fin: 4 });
  });
});

describe("recortarReferencia", () => {
  it("conserva las notas que empiezan dentro y recorta la última", () => {
    const r = recortarReferencia(ref, { inicio: 1, fin: 7 });
    expect(r.notas.map((n) => n.inicio)).toEqual([1, 3, 6]);
    expect(r.notas[2].fin).toBe(7);
    expect(r.contorno!.map((p) => p.t)).toEqual([2, 4, 6]);
    expect(r.duracion).toBe(7);
    // no muta la original
    expect(ref.notas[3].fin).toBe(9);
  });
});

describe("desplazarContorno", () => {
  it("suma el desfase a cada punto", () => {
    const c = desplazarContorno([{ t: 0, midi: 60, claridad: 1 }, { t: 0.5, midi: null, claridad: 0 }], 2);
    expect(c.map((p) => p.t)).toEqual([2, 2.5]);
    expect(c[1].midi).toBeNull();
  });
});

describe("notaEn", () => {
  it("encuentra la nota que suena", () => {
    expect(notaEn(ref.notas, 1.2)?.midi).toBe(62);
    expect(notaEn(ref.notas, 2.7)).toBeNull();
    expect(notaEn(ref.notas, 8.99)?.midi).toBe(65);
    expect(notaEn([], 1)).toBeNull();
  });
});

describe("duracionReferencia", () => {
  it("usa el máximo entre duración, notas y contorno", () => {
    expect(duracionReferencia({ ...ref, duracion: 0 })).toBe(9);
    expect(duracionReferencia(ref)).toBe(10);
  });
});

describe("octavaEnVivo", () => {
  const puntos = (midi: number | null) =>
    Array.from({ length: 30 }, (_, i) => ({ t: 1 + i * 0.05, midi, claridad: 1 }));
  it("detecta una octava por debajo", () => {
    expect(octavaEnVivo(puntos(50), ref.notas, 0)).toBe(-1);
  });
  it("tiene en cuenta la transposición", () => {
    expect(octavaEnVivo(puntos(64), ref.notas, 0, 2)).toBe(0);
  });
  it("0 con pocos datos o silencio", () => {
    expect(octavaEnVivo(puntos(null), ref.notas, 0)).toBe(0);
    expect(octavaEnVivo(puntos(50).slice(0, 5), ref.notas, 0)).toBe(0);
  });
});
