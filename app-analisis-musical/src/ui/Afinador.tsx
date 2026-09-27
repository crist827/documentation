// Función 1: afinador en tiempo real con gráfica de los últimos 10 s.

import { useEffect, useMemo, useRef } from "react";
import { useMicPitch } from "../audio/useMicPitch";
import type { LecturaPitch } from "../audio/detector";
import { configNotas } from "../ajustes";
import { useApp } from "./estadoApp";
import { nombreNota } from "../notas";
import { conSigno } from "./formato";
import { usePantallaActiva } from "./usePantallaActiva";
import type { Contorno } from "../tipos";

/** Tiempo que se mantiene la última nota (atenuada) tras dejar de cantar. */
const MS_RETENER = 400;
const SEGUNDOS_GRAFICA = 10;
const ALTO_GRAFICA = 220;

type Nivel = "ok" | "aviso" | "error";

function nivelCents(c: number): Nivel {
  const a = Math.abs(c);
  return a <= 10 ? "ok" : a <= 25 ? "aviso" : "error";
}

const COLOR_NIVEL: Record<Nivel, string> = {
  ok: "var(--ok, #2e9d5b)",
  aviso: "var(--aviso, #d99a1e)",
  error: "var(--error, #d64545)",
};

export default function Afinador() {
  const mic = useMicPitch();
  usePantallaActiva(mic.activo);
  const { ajustes } = useApp();
  const cfg = useMemo(() => configNotas(ajustes), [ajustes]);
  // El detector trabaja con La4 = 440; desplazamos si el usuario usa otro La.
  const desfase = 12 * Math.log2(cfg.la4 / 440);

  // Retención de la última lectura válida para que la nota no parpadee
  const retenida = useRef<{ l: LecturaPitch; en: number } | null>(null);
  const ahora = performance.now();
  if (!mic.activo) retenida.current = null;
  else if (mic.ultimo?.midi != null) retenida.current = { l: mic.ultimo, en: ahora };
  const r = retenida.current;
  const vigente = mic.ultimo?.midi != null;
  const mostrada = vigente ? mic.ultimo : r && ahora - r.en < MS_RETENER ? r.l : null;

  const midi = mostrada?.midi != null ? mostrada.midi - desfase : null;
  const cents = midi != null ? (midi - Math.round(midi)) * 100 : 0;
  const nivel = nivelCents(cents);

  // Datos para el bucle de dibujo (sin re-suscribir el efecto en cada render)
  const datos = useRef({ historial: mic.historial, ctx: mic.ctx, activo: mic.activo, desfase, cfg });
  datos.current = { historial: mic.historial, ctx: mic.ctx, activo: mic.activo, desfase, cfg };

  const contRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const cont = contRef.current;
    const cv = canvasRef.current;
    if (!cont || !cv) return;
    const g = cv.getContext("2d");
    if (!g) return;

    let ancho = 0;
    let dpr = 1;
    const ajustar = () => {
      dpr = window.devicePixelRatio || 1;
      ancho = cont.clientWidth;
      cv.width = Math.round(ancho * dpr);
      cv.height = Math.round(ALTO_GRAFICA * dpr);
    };
    ajustar();
    const ro = new ResizeObserver(ajustar);
    ro.observe(cont);

    const rango = { lo: 51, hi: 63 };
    let colores = leerColores();
    let frames = 0;
    let raf = 0;
    const bucle = () => {
      if (++frames % 60 === 0) colores = leerColores(); // sigue cambios de tema
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      dibujar(g, ancho, ALTO_GRAFICA, datos.current, rango, colores);
      raf = requestAnimationFrame(bucle);
    };
    raf = requestAnimationFrame(bucle);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  return (
    <section className="afinador">
      <div className="afinador-controles">
        <button
          type="button"
          className={mic.activo ? "boton boton-detener" : "boton boton-primario"}
          onClick={() => (mic.activo ? mic.detener() : void mic.iniciar())}
        >
          {mic.activo ? "Detener micrófono" : "Iniciar micrófono"}
        </button>
      </div>

      {mic.error && (
        <p className="error" role="alert">
          {mic.error}
        </p>
      )}

      <div
        className={`afinador-lectura${vigente ? "" : " afinador-apagado"}`}
        style={{ textAlign: "center", opacity: vigente || !mostrada ? 1 : 0.5 }}
      >
        <div className="afinador-nota" style={{ fontSize: "3.5rem", fontWeight: 700, lineHeight: 1.1 }}>
          {midi != null ? nombreNota(midi, cfg) : "—"}
        </div>
        <div className="afinador-hz">{mostrada?.hz != null ? `${mostrada.hz.toFixed(1)} Hz` : "— Hz"}</div>

        <div
          className="medidor-cents"
          role="meter"
          aria-label="Desafinación en cents"
          aria-valuemin={-50}
          aria-valuemax={50}
          aria-valuenow={Math.round(cents)}
          style={{ position: "relative", height: 28, margin: "12px auto 4px", maxWidth: 420 }}
        >
          <div
            className="medidor-zonas"
            style={{
              position: "absolute",
              inset: "8px 0",
              borderRadius: 6,
              opacity: 0.3,
              background: `linear-gradient(to right, ${COLOR_NIVEL.error} 0 25%, ${COLOR_NIVEL.aviso} 25% 40%, ${COLOR_NIVEL.ok} 40% 60%, ${COLOR_NIVEL.aviso} 60% 75%, ${COLOR_NIVEL.error} 75% 100%)`,
            }}
          />
          <div
            style={{ position: "absolute", left: "50%", top: 4, bottom: 4, width: 1, background: "var(--texto, #222)", opacity: 0.4 }}
          />
          {midi != null && (
            <div
              className="medidor-aguja"
              style={{
                position: "absolute",
                top: 0,
                bottom: 0,
                width: 4,
                marginLeft: -2,
                borderRadius: 2,
                left: `${50 + Math.max(-50, Math.min(50, cents))}%`,
                background: COLOR_NIVEL[nivel],
                transition: "left 60ms linear",
              }}
            />
          )}
        </div>
        <div className="medidor-escala" style={{ display: "flex", justifyContent: "space-between", maxWidth: 420, margin: "0 auto", fontSize: "0.75rem", opacity: 0.7 }}>
          <span>−50</span>
          <span>0</span>
          <span>+50</span>
        </div>
        <div className="afinador-cents" style={{ color: midi != null ? COLOR_NIVEL[nivel] : undefined, fontWeight: 600 }}>
          {midi != null ? `${conSigno(cents)} cents` : " "}
        </div>
      </div>

      <div className="afinador-grafica" ref={contRef} style={{ width: "100%", marginTop: 12 }}>
        <canvas
          ref={canvasRef}
          role="img"
          aria-label="Gráfica del tono cantado en los últimos 10 segundos"
          style={{ display: "block", width: "100%", height: ALTO_GRAFICA, borderRadius: 8 }}
        />
      </div>

      <p className="aviso">Consejo: usa auriculares y un lugar silencioso.</p>
    </section>
  );
}

// ---------- Gráfica ----------

interface Colores {
  texto: string;
  fondo: string;
  acento: string;
  borde: string;
  ok: string;
  aviso: string;
  error: string;
}

function leerColores(): Colores {
  const cs = getComputedStyle(document.documentElement);
  const v = (n: string, def: string) => cs.getPropertyValue(n).trim() || def;
  return {
    texto: v("--texto", "#222"),
    fondo: v("--fondo-2", "#f3f3f5"),
    acento: v("--acento", "#5b5bd6"),
    borde: v("--borde", "#ccc"),
    ok: v("--ok", "#2e9d5b"),
    aviso: v("--aviso", "#d99a1e"),
    error: v("--error", "#d64545"),
  };
}

interface DatosGrafica {
  historial: Contorno;
  ctx: AudioContext | null;
  activo: boolean;
  desfase: number;
  cfg: ReturnType<typeof configNotas>;
}

const MARGEN_IZQ = 44;
const MARGEN = 8;

function dibujar(
  g: CanvasRenderingContext2D,
  w: number,
  h: number,
  d: DatosGrafica,
  rango: { lo: number; hi: number },
  c: Colores,
) {
  g.clearRect(0, 0, w, h);
  g.fillStyle = c.fondo;
  g.fillRect(0, 0, w, h);
  if (w <= MARGEN_IZQ + MARGEN) return;

  const hist = d.historial;
  const ultimoT = hist.length ? hist[hist.length - 1].t : 0;
  // Activo: desplaza con el reloj de audio; detenido: congela en el último punto
  const ahora = d.activo && d.ctx ? Math.max(d.ctx.currentTime, ultimoT) : ultimoT;
  const t0 = ahora - SEGUNDOS_GRAFICA;

  // Rango vertical: se adapta a lo cantado (mínimo 1 octava) con transición suave
  let min = Infinity;
  let max = -Infinity;
  for (const p of hist) {
    if (p.midi == null || p.t < t0) continue;
    const m = p.midi - d.desfase;
    if (m < min) min = m;
    if (m > max) max = m;
  }
  if (min <= max) {
    let lo = Math.floor(min) - 1;
    let hi = Math.ceil(max) + 1;
    if (hi - lo < 12) {
      const centro = (lo + hi) / 2;
      lo = centro - 6;
      hi = centro + 6;
    }
    rango.lo += (lo - rango.lo) * 0.12;
    rango.hi += (hi - rango.hi) * 0.12;
  }

  const x0 = MARGEN_IZQ;
  const x1 = w - MARGEN;
  const y0 = MARGEN;
  const y1 = h - MARGEN;
  const px = (t: number) => x0 + ((t - t0) / SEGUNDOS_GRAFICA) * (x1 - x0);
  const py = (m: number) => y1 - ((m - rango.lo) / (rango.hi - rango.lo)) * (y1 - y0);
  const pxSemitono = (y1 - y0) / (rango.hi - rango.lo);

  // Líneas de nota y etiquetas
  g.font = "11px system-ui, sans-serif";
  g.textAlign = "right";
  g.textBaseline = "middle";
  g.lineWidth = 1;
  for (let m = Math.ceil(rango.lo); m <= Math.floor(rango.hi); m++) {
    const nombre = nombreNota(m, d.cfg);
    const esDo = ((m % 12) + 12) % 12 === 0;
    const natural = !nombre.includes("#");
    const y = Math.round(py(m)) + 0.5;
    g.strokeStyle = c.borde;
    g.globalAlpha = esDo ? 1 : natural ? 0.6 : 0.25;
    g.beginPath();
    g.moveTo(x0, y);
    g.lineTo(x1, y);
    g.stroke();
    const etiquetar = pxSemitono >= 14 || (natural && pxSemitono >= 8) || esDo;
    if (etiquetar) {
      g.globalAlpha = esDo ? 1 : natural ? 0.8 : 0.5;
      g.fillStyle = c.texto;
      g.fillText(nombre, x0 - 6, y);
    }
  }
  g.globalAlpha = 1;

  // Contorno: se corta en silencios o huecos y se colorea según los cents
  g.lineWidth = 2.5;
  g.lineJoin = "round";
  g.lineCap = "round";
  const color = (m: number) => {
    const n = nivelCents((m - Math.round(m)) * 100);
    return n === "ok" ? c.ok : n === "aviso" ? c.aviso : c.error;
  };
  let prev: { x: number; y: number; t: number } | null = null;
  let colorActual = "";
  g.beginPath();
  for (const p of hist) {
    if (p.t < t0 - 0.1) continue;
    if (p.midi == null) {
      prev = null;
      continue;
    }
    const m = p.midi - d.desfase;
    const x = px(p.t);
    const y = py(m);
    const col = color(m);
    if (prev && p.t - prev.t < 0.06) {
      if (col !== colorActual) {
        g.stroke();
        g.strokeStyle = colorActual = col;
        g.beginPath();
        g.moveTo(prev.x, prev.y);
      }
      g.lineTo(x, y);
    } else {
      g.moveTo(x, y);
    }
    prev = { x, y, t: p.t };
  }
  g.stroke();

  // Punto de la lectura más reciente
  const ult = hist[hist.length - 1];
  if (d.activo && ult?.midi != null && ahora - ult.t < 0.15) {
    const m = ult.midi - d.desfase;
    g.fillStyle = c.acento;
    g.beginPath();
    g.arc(px(ult.t), py(m), 4, 0, Math.PI * 2);
    g.fill();
  }
}
