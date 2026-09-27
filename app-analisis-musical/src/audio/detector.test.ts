import { describe, expect, it } from "vitest";
import { DetectorVoz, OPCIONES_DETECTOR, calcularRmsDb } from "./detector";
import { hzAMidi } from "../notas";

const SR = 48000;
const N = 2048;

/** Senoidal con fase continua a partir de la muestra `desde`. */
function seno(hz: number, amp = 0.5, desde = 0): Float32Array {
  const b = new Float32Array(N);
  for (let i = 0; i < N; i++) b[i] = amp * Math.sin((2 * Math.PI * hz * (desde + i)) / SR);
  return b;
}

/** Ruido blanco uniforme con semilla (reproducible). */
function ruido(amp: number, semilla = 1): Float32Array {
  let x = semilla >>> 0;
  const b = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    b[i] = amp * ((x / 2 ** 32) * 2 - 1);
  }
  return b;
}

describe("DetectorVoz", () => {
  it("expone las opciones por defecto del diseño", () => {
    expect(OPCIONES_DETECTOR).toEqual({ minHz: 70, maxHz: 1100, claridadMin: 0.9, rmsMinDb: -45, ventanaMediana: 5 });
    expect(new DetectorVoz(SR).tamano).toBe(2048);
  });

  it.each([110, 220, 440, 261.63, 987.77])("detecta una senoidal de %s Hz", (hz) => {
    const d = new DetectorVoz(SR);
    const l = d.procesar(seno(hz));
    expect(l.midi).not.toBeNull();
    expect(l.midi!).toBeCloseTo(hzAMidi(hz), 1);
    expect(Math.abs(l.midi! - hzAMidi(hz))).toBeLessThan(0.1);
    expect(l.hz!).toBeCloseTo(hz, 0);
    expect(l.claridad).toBeGreaterThan(0.9);
  });

  it("devuelve decimales (cents) y no redondea a la nota", () => {
    const hz = 440 * 2 ** (0.3 / 12); // La4 +30 c
    const l = new DetectorVoz(SR).procesar(seno(hz));
    expect(l.midi!).toBeCloseTo(69.3, 1);
  });

  it("silencio → null", () => {
    const l = new DetectorVoz(SR).procesar(new Float32Array(N));
    expect(l.midi).toBeNull();
    expect(l.hz).toBeNull();
    expect(l.rmsDb).toBe(-Infinity);
  });

  it("ruido blanco débil → null (puerta RMS)", () => {
    const b = ruido(0.005);
    expect(calcularRmsDb(b)).toBeLessThan(-45);
    const l = new DetectorVoz(SR).procesar(b);
    expect(l.midi).toBeNull();
    expect(l.claridad).toBe(0);
  });

  it("ruido blanco fuerte → null o claridad baja", () => {
    const d = new DetectorVoz(SR);
    for (let s = 1; s <= 10; s++) {
      const l = d.procesar(ruido(0.5, s));
      expect(l.rmsDb).toBeGreaterThan(-45);
      expect(l.midi === null || l.claridad < 0.9).toBe(true);
    }
  });

  it("senoidal por debajo de la puerta de volumen → null", () => {
    expect(new DetectorVoz(SR).procesar(seno(220, 0.005)).midi).toBeNull();
  });

  it("descarta frecuencias fuera de rango", () => {
    expect(new DetectorVoz(SR).procesar(seno(1500)).midi).toBeNull();
    expect(new DetectorVoz(SR, N, { maxHz: 300 }).procesar(seno(440)).midi).toBeNull();
  });

  it("la mediana elimina un salto de octava aislado", () => {
    const d = new DetectorVoz(SR);
    const salidas: number[] = [];
    for (let k = 0; k < 10; k++) {
      const hz = k === 5 ? 440 : 220;
      const l = d.procesar(seno(hz, 0.5, k * 480));
      salidas.push(l.midi!);
    }
    for (const m of salidas) expect(Math.abs(m - 57)).toBeLessThan(0.1);
  });

  it("el salto al principio del historial tampoco pasa", () => {
    const d = new DetectorVoz(SR);
    d.procesar(seno(220));
    expect(d.procesar(seno(440)).midi!).toBeCloseTo(57, 1);
  });

  it("sigue un cambio de nota real tras unos frames", () => {
    const d = new DetectorVoz(SR);
    for (let k = 0; k < 5; k++) d.procesar(seno(220));
    let ultima = 0;
    for (let k = 0; k < 4; k++) ultima = d.procesar(seno(329.63)).midi!;
    expect(ultima).toBeCloseTo(64, 1);
  });

  it("tras varios silencios seguidos vacía el historial", () => {
    const d = new DetectorVoz(SR);
    for (let k = 0; k < 5; k++) d.procesar(seno(220));
    for (let k = 0; k < 3; k++) expect(d.procesar(new Float32Array(N)).midi).toBeNull();
    // la nueva nota aparece de inmediato, sin arrastrar la anterior
    expect(d.procesar(seno(440)).midi!).toBeCloseTo(69, 1);
  });

  it("reiniciar() vacía el historial", () => {
    const d = new DetectorVoz(SR);
    for (let k = 0; k < 5; k++) d.procesar(seno(220));
    d.reiniciar();
    expect(d.procesar(seno(440)).midi!).toBeCloseTo(69, 1);
  });

  it("acepta buffers más largos usando las últimas muestras", () => {
    const d = new DetectorVoz(SR, 1024);
    expect(d.procesar(seno(220)).midi!).toBeCloseTo(57, 1);
  });
});
