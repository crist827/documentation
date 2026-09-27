import { describe, expect, it } from "vitest";
import type { Informe, OpcionesComparacion } from "../tipos";
import { comparar } from "./comparar";
import { alinearDTW } from "./dtw";
import { estimarLatencia } from "./latencia";
import { estimarOctava } from "./octava";
import { contorno, imitar, melodia, nota, referencia } from "./sinteticos";

const OPC: OpcionesComparacion = { nivel: "intermedio", corregirOctava: false, transposicion: 0, modo: "sincronizado", latenciaMs: 0 };

/** Comprueba que no hay NaN/Infinity en ningún número del informe. */
function sinNaN(inf: Informe) {
  const revisar = (v: unknown, ruta: string) => {
    if (typeof v === "number") expect(Number.isFinite(v), ruta).toBe(true);
    else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) revisar(x, `${ruta}.${k}`);
  };
  revisar({ ...inf, contornoUsuario: [] }, "informe");
}

describe("comparar", () => {
  it("usuario perfecto: todo afinado, puntuación alta y consejo positivo", () => {
    const ref = melodia();
    const inf = comparar(ref, imitar(ref), { ...OPC, latenciaMs: undefined });
    expect(inf.latenciaMs).toBe(0);
    expect(inf.resultados.every((r) => r.estado === "afinada")).toBe(true);
    for (const r of inf.resultados) {
      expect(Math.abs(r.retrasoEntradaMs)).toBeLessThanOrEqual(10);
      expect(Math.abs(r.diferenciaFinMs)).toBeLessThanOrEqual(10);
      expect(r.scoop).toBe(false);
    }
    expect(inf.puntuacion).toBeGreaterThanOrEqual(95);
    expect(inf.consejos[0].id).toBe("bien");
    sinNaN(inf);
  });

  it("usuario 40 c bajo: sesgo ≈ −40 y el primer consejo es 'calado'", () => {
    const ref = melodia();
    const inf = comparar(ref, imitar(ref, { desvio: -0.4 }), OPC);
    expect(inf.metricas.sesgoCents).toBeCloseTo(-40, 0);
    expect(inf.resultados[0].desvioHz).toBeLessThan(0);
    expect(inf.consejos[0].id).toBe("calado");
  });

  it("una octava por debajo con corregirOctava → afinado y desplazamiento −1", () => {
    const ref = melodia();
    const usuario = imitar(ref, { desvio: -12 });
    expect(estimarOctava(usuario, ref)).toBe(-1);
    const inf = comparar(ref, usuario, { ...OPC, corregirOctava: true });
    expect(inf.desplazamientoOctava).toBe(-1);
    expect(inf.resultados.every((r) => r.estado === "afinada")).toBe(true);
    // Sin corrección, todas desafinadas.
    const sin = comparar(ref, usuario, OPC);
    expect(sin.resultados.every((r) => r.estado === "desafinada")).toBe(true);
  });

  it("transposición: cantar +2 semitonos a propósito no es error", () => {
    const ref = melodia();
    const inf = comparar(ref, imitar(ref, { desvio: 2 }), { ...OPC, transposicion: 2 });
    expect(inf.resultados.every((r) => r.estado === "afinada")).toBe(true);
  });

  it("120 ms de retraso: se estima la latencia y las entradas quedan ≈ 0", () => {
    const ref = melodia();
    const usuario = imitar(ref, { retraso: 0.12 });
    expect(Math.abs(estimarLatencia(usuario, ref) - 120)).toBeLessThanOrEqual(20);
    const inf = comparar(ref, usuario, { ...OPC, latenciaMs: undefined });
    expect(Math.abs(inf.latenciaMs - 120)).toBeLessThanOrEqual(20);
    expect(Math.abs(inf.metricas.retrasoEntradaMedioMs)).toBeLessThanOrEqual(20);
    // Sin compensar, entra tarde.
    const sin = comparar(ref, usuario, OPC);
    expect(sin.metricas.retrasoEntradaMedioMs).toBeGreaterThan(100);
  });

  it("latencia sin datos suficientes → 0", () => {
    const ref = melodia();
    expect(estimarLatencia(contorno(5, () => null), ref)).toBe(0);
    expect(estimarLatencia([], ref)).toBe(0);
  });

  it("modo libre: el DTW recupera la afinación cantando al 85 % de velocidad", () => {
    const ref = melodia();
    const usuario = imitar(ref, { velocidad: 0.85 });
    const sinAlinear = comparar(ref, usuario, OPC);
    const inf = comparar(ref, usuario, { ...OPC, modo: "libre" });
    expect(inf.latenciaMs).toBe(0);
    const afinadas = inf.resultados.filter((r) => r.estado === "afinada").length;
    expect(afinadas / inf.resultados.length).toBeGreaterThanOrEqual(0.9);
    expect(inf.metricas.errorMedioCents).toBeLessThan(15);
    expect(inf.metricas.pctNotasAfinadas).toBeGreaterThan(sinAlinear.metricas.pctNotasAfinadas);
  });

  it("vibrato de 5,5 Hz ±50 c: se detecta y no cuenta como inestabilidad", () => {
    const ref = referencia([nota(69, 0.5, 2.5)]);
    const usuario = contorno(3, (t) => (t >= 0.5 && t < 2.5 ? 69 + 0.5 * Math.sin(2 * Math.PI * 5.5 * (t - 0.5)) : null));
    const r = comparar(ref, usuario, OPC).resultados[0];
    expect(r.vibrato).toBeDefined();
    expect(Math.abs(r.vibrato!.hz - 5.5)).toBeLessThanOrEqual(0.7);
    expect(r.vibrato!.amplitudCents).toBeGreaterThan(35);
    expect(r.vibrato!.amplitudCents).toBeLessThan(65);
    expect(r.estabilidadCents).toBeLessThan(15);
    expect(r.estado).toBe("afinada");
  });

  it("nota recta: sin vibrato y estabilidad ≈ 0", () => {
    const ref = referencia([nota(69, 0.5, 2.5)]);
    const r = comparar(ref, imitar(ref), OPC).resultados[0];
    expect(r.vibrato).toBeUndefined();
    expect(r.estabilidadCents).toBeLessThan(1);
  });

  it("detecta el scoop (entrada desde abajo) y mide el ataque", () => {
    const ref = referencia([nota(64, 0.5, 1.5), nota(67, 2, 3)]);
    // Entra 120 c por debajo y sube en 80 ms.
    const usuario = contorno(3.5, (t) => {
      for (const n of ref.notas) {
        if (t >= n.inicio && t < n.fin) {
          const x = t - n.inicio;
          return x < 0.08 ? n.midi - 1.2 * (1 - x / 0.08) : n.midi;
        }
      }
      return null;
    });
    const inf = comparar(ref, usuario, OPC);
    for (const r of inf.resultados) {
      expect(r.scoop).toBe(true);
      expect(r.ataqueMs).toBeGreaterThan(40);
      expect(r.ataqueMs).toBeLessThan(120);
    }
    expect(inf.metricas.pctScoop).toBe(100);
    expect(inf.consejos.map((c) => c.id)).toContain("scoop");
  });

  it("detecta la deriva hacia abajo en notas largas", () => {
    const ref = referencia([nota(67, 0.5, 2.5), nota(64, 3, 5)]);
    const usuario = contorno(5.5, (t) => {
      for (const n of ref.notas) if (t >= n.inicio && t < n.fin) return n.midi + 0.2 - 0.4 * (t - n.inicio);
      return null;
    });
    const inf = comparar(ref, usuario, OPC);
    for (const r of inf.resultados) expect(r.derivaCentsPorSeg).toBeCloseTo(-40, 0);
    expect(inf.metricas.derivaCentsPorSeg).toBeCloseTo(-40, 0);
    expect(inf.consejos.map((c) => c.id)).toContain("se-caen");
  });

  it("silencio total: todas omitidas, sin NaN y puntuación 0", () => {
    const ref = melodia();
    const usuario = contorno(ref.duracion, () => null);
    for (const modo of ["sincronizado", "libre"] as const) {
      const inf = comparar(ref, usuario, { ...OPC, modo, latenciaMs: undefined, corregirOctava: true });
      expect(inf.resultados.every((r) => r.estado === "omitida")).toBe(true);
      expect(inf.metricas.pctNotasOmitidas).toBe(100);
      expect(inf.puntuacion).toBe(0);
      expect(inf.consejos[0].id).toBe("omisiones");
      sinNaN(inf);
    }
  });

  it("contorno vacío no rompe", () => {
    const inf = comparar(melodia(), [], { ...OPC, latenciaMs: undefined });
    expect(inf.resultados.every((r) => r.estado === "omitida")).toBe(true);
    sinNaN(inf);
  });
});

describe("alinearDTW", () => {
  it("aguanta 4 minutos de audio sin matriz completa", () => {
    const notas = [];
    const escala = [60, 62, 64, 65, 67, 69, 71, 72];
    for (let i = 0; i < 480; i++) notas.push(nota(escala[(i * 3) % 8], 0.5 * i, 0.5 * i + 0.45));
    const ref = referencia(notas);
    const usuario = imitar(ref, { velocidad: 0.95 });
    const t0 = performance.now();
    const alineado = alinearDTW(usuario, ref);
    expect(performance.now() - t0).toBeLessThan(5000);
    expect(alineado.length).toBeGreaterThan(11000);
    // La mayoría de frames alineados coinciden con la referencia.
    let bien = 0;
    let total = 0;
    for (const p of alineado) {
      const n = notas.find((x) => p.t >= x.inicio + 0.04 && p.t < x.fin - 0.04);
      if (!n || p.midi == null) continue;
      total++;
      if (Math.abs(p.midi - n.midi) < 0.3) bien++;
    }
    expect(bien / total).toBeGreaterThan(0.9);
  });

  it("sin voz devuelve un contorno en silencio", () => {
    const ref = melodia();
    const c = alinearDTW(contorno(3, () => null), ref);
    expect(c.every((p) => p.midi == null)).toBe(true);
  });
});
