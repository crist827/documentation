import { describe, expect, it } from "vitest";
import { segmentar } from "./segmentar";
import { analizarMuestras } from "./worker";
import { contornoDesdeAudio } from "./yin";
import { ruido, sintetizar, SR } from "./senalesPrueba";
import type { Contorno } from "../tipos";

const centsError = (a: number, b: number) => Math.abs(a - b) * 100;

describe("segmentar (contorno sintético)", () => {
  const hop = 0.01;
  const contorno = (valores: (number | null)[]): Contorno => valores.map((m, i) => ({ t: i * hop, midi: m, claridad: m === null ? 0 : 0.95 }));

  it("abre nota nueva tras un cambio sostenido y tras silencio", () => {
    const v = [...Array(30).fill(60), ...Array(30).fill(62), ...Array(10).fill(null), ...Array(30).fill(62)];
    const n = segmentar(contorno(v));
    expect(n.map((x) => Math.round(x.midi))).toEqual([60, 62, 62]);
    expect(n[1].inicio).toBeCloseTo(0.295, 3);
  });

  it("un desvío breve (< 50 ms) no parte la nota", () => {
    const v = [...Array(30).fill(60), ...Array(3).fill(63), ...Array(30).fill(60)];
    expect(segmentar(contorno(v))).toHaveLength(1);
  });

  it("descarta notas cortas y fusiona legato", () => {
    const v = [...Array(30).fill(60), ...Array(5).fill(null), ...Array(30).fill(60.2), ...Array(10).fill(null), ...Array(5).fill(67)];
    const n = segmentar(contorno(v));
    expect(n).toHaveLength(1);
    expect(n[0].fin).toBeCloseTo(0.645, 3);
  });
});

describe("pipeline de audio sintético", () => {
  it("Do4-Mi4-Sol4 de 0.5 s con silencios: pitch ±10 c e inicios ±30 ms", () => {
    const ref = [
      { inicio: 0.3, fin: 0.8, midi: 60 },
      { inicio: 1.0, fin: 1.5, midi: 64 },
      { inicio: 1.7, fin: 2.2, midi: 67 },
    ];
    const { notas } = analizarMuestras(sintetizar(ref, 2.6), SR, "acapella");
    expect(notas).toHaveLength(3);
    notas.forEach((n, i) => {
      expect(centsError(n.midi, ref[i].midi)).toBeLessThan(10);
      expect(Math.abs(n.inicio - ref[i].inicio)).toBeLessThan(0.03);
      expect(Math.abs(n.fin - ref[i].fin)).toBeLessThan(0.05);
    });
  });

  it("legato Do4→Re4 sin silencio se separa en dos notas", () => {
    const ref = [
      { inicio: 0.2, fin: 0.7, midi: 60 },
      { inicio: 0.7, fin: 1.2, midi: 62 },
    ];
    const { notas } = analizarMuestras(sintetizar(ref, 1.4), SR, "acapella");
    expect(notas).toHaveLength(2);
    expect(Math.abs(notas[1].inicio - 0.7)).toBeLessThan(0.03);
    notas.forEach((n, i) => expect(centsError(n.midi, ref[i].midi)).toBeLessThan(10));
  });

  it("vibrato ±40 c a 5.5 Hz no parte la nota", () => {
    const ref = [{ inicio: 0.2, fin: 2.2, midi: 64, vibrato: { cents: 40, hz: 5.5 } }];
    const { notas } = analizarMuestras(sintetizar(ref, 2.5), SR, "acapella");
    expect(notas).toHaveLength(1);
    expect(centsError(notas[0].midi, 64)).toBeLessThan(15);
    expect(Math.abs(notas[0].inicio - 0.2)).toBeLessThan(0.03);
  });

  it("ruido → sin notas", () => {
    expect(analizarMuestras(ruido(3), SR, "acapella").notas).toHaveLength(0);
    expect(analizarMuestras(ruido(3), SR, "cancion").notas).toHaveLength(0);
  });

  it("modo canción sobre voz con ruido de fondo", () => {
    const ref = [
      { inicio: 0.3, fin: 0.8, midi: 57 },
      { inicio: 1.0, fin: 1.5, midi: 60 },
    ];
    const voz = sintetizar(ref, 1.8, SR, 0.5);
    const fondo = ruido(1.8, SR, 0.01, 7);
    for (let i = 0; i < voz.length; i++) voz[i] += fondo[i];
    const { notas } = analizarMuestras(voz, SR, "cancion");
    expect(notas).toHaveLength(2);
    notas.forEach((n, i) => expect(centsError(n.midi, ref[i].midi)).toBeLessThan(10));
  });

  it("el contorno tiene un frame cada 10 ms", () => {
    const c = contornoDesdeAudio(sintetizar([{ inicio: 0.1, fin: 0.5, midi: 60 }], 0.6), SR);
    expect(c.length).toBeGreaterThanOrEqual(60);
  });
});
