import { describe, expect, it } from "vitest";
import { contornoDesdeAudio, OPCIONES_CANCION, yinFrame } from "./yin";
import { hzAMidi } from "../notas";
import { ruido, sintetizar, SR } from "./senalesPrueba";

describe("yinFrame", () => {
  it.each([82.41, 130.81, 261.63, 440, 880])("detecta %f Hz con ±10 cents", (hz) => {
    const x = sintetizar([{ inicio: 0, fin: 0.2, midi: hzAMidi(hz) }], 0.2);
    const frame = x.subarray(1000, 1000 + 1024);
    const r = yinFrame(frame, SR, 65, 1100);
    expect(r.hz).not.toBeNull();
    expect(Math.abs(hzAMidi(r.hz as number) - hzAMidi(hz)) * 100).toBeLessThan(10);
    expect(r.claridad).toBeGreaterThan(0.9);
  });

  it("ruido blanco tiene claridad baja", () => {
    const r = yinFrame(ruido(0.1).subarray(0, 1024), SR, 65, 1100);
    expect(r.claridad).toBeLessThan(0.7);
  });
});

describe("contornoDesdeAudio", () => {
  it("t es el centro de la ventana y cubre todo el audio", () => {
    const c = contornoDesdeAudio(sintetizar([{ inicio: 0.2, fin: 0.8, midi: 60 }], 1), SR);
    expect(c[0].t).toBe(0);
    expect(c[1].t).toBeCloseTo(0.01, 3);
    expect(c[c.length - 1].t).toBeGreaterThan(0.98);
    const voz = c.filter((p) => p.midi !== null);
    expect(voz[0].t).toBeGreaterThan(0.17);
    expect(voz[0].t).toBeLessThan(0.23);
    for (const p of voz) expect(Math.abs(p.midi! - 60) * 100).toBeLessThan(10);
  });

  it("ruido → sin frames sonoros (casi)", () => {
    const c = contornoDesdeAudio(ruido(2), SR);
    expect(c.filter((p) => p.midi !== null).length).toBeLessThan(c.length * 0.02);
  });

  it("corrige saltos de octava aislados", () => {
    // Do4 con 30 ms una octava arriba en medio.
    const x = sintetizar(
      [
        { inicio: 0.1, fin: 0.5, midi: 60 },
        { inicio: 0.5, fin: 0.53, midi: 72 },
        { inicio: 0.53, fin: 0.9, midi: 60 },
      ],
      1,
    );
    const c = contornoDesdeAudio(x, SR);
    for (const p of c) if (p.midi !== null && p.t > 0.15 && p.t < 0.85) expect(Math.abs(p.midi - 60)).toBeLessThan(0.3);
  });

  it("opciones de canción descartan frecuencias fuera del rango vocal", () => {
    const x = sintetizar([{ inicio: 0.1, fin: 0.9, midi: hzAMidi(1300) }], 1);
    const c = contornoDesdeAudio(x, SR, OPCIONES_CANCION);
    // 1300 Hz está fuera de 80–1000: o sin voz o una subarmónica, pero nunca 1300.
    for (const p of c) if (p.midi !== null) expect(Math.abs(p.midi - hzAMidi(1300))).toBeGreaterThan(1);
  });

  it("rendimiento: 60 s de audio", () => {
    const notas = [];
    for (let t = 0; t < 60; t += 0.5) notas.push({ inicio: t, fin: t + 0.45, midi: 55 + ((t * 2) % 12) });
    const x = sintetizar(notas, 60);
    const t0 = performance.now();
    const c = contornoDesdeAudio(x, SR);
    const ms = performance.now() - t0;
    console.log(`contornoDesdeAudio(60 s @ 22.05 kHz): ${ms.toFixed(0)} ms, ${c.length} frames`);
    expect(ms).toBeLessThan(5000);
  }, 30000);
});
