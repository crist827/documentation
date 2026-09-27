// Piano-roll en canvas: notas de referencia, contornos de pitch y cursor.
import { useEffect, useMemo, useRef, useState, type PointerEvent as PE } from "react";
import type { Contorno, EstadoNota, Nota, ResultadoNota, Tolerancia } from "../tipos";
import type { Ajustes } from "../ajustes";
import { nombreNota } from "../notas";
import { notaEn } from "../referencia/fragmento";
import { duracionTotal, esTeclaNegra, etiquetaTiempo, indiceDesde, pasoMarcas, rangoMidi } from "./pianoRollCalculo";

export interface PropsPianoRoll {
  notas: Nota[];
  contornoRef?: Contorno;
  contornoUsuario?: Contorno;
  resultados?: ResultadoNota[];
  /** Si está definido, la vista sigue este instante (modo karaoke). */
  tiempoActual?: number;
  /** Segundos visibles en modo karaoke. */
  ventanaSeg?: number;
  ajustes: Pick<Ajustes, "la4" | "convencion">;
  /** Alto en px CSS. */
  alto?: number;
  /** Si se da, el contorno del usuario se colorea según su distancia a la nota esperada. */
  tolerancia?: Tolerancia;
  /** Semitonos que se suman al contorno del usuario al dibujarlo (octava/transposición). */
  desplazarUsuario?: number;
  /** Mostrar la leyenda bajo el gráfico. */
  leyenda?: boolean;
}

interface Colores {
  fondo: string;
  fondo3: string;
  texto2: string;
  borde: string;
  acento: string;
  ok: string;
  aviso: string;
  error: string;
  ref: string;
  usuario: string;
  omitida: string;
}

const MARGEN = { izq: 46, der: 6, sup: 6, inf: 20 };

function leerColores(el: Element): Colores {
  const cs = getComputedStyle(el);
  const v = (n: string, def: string) => cs.getPropertyValue(n).trim() || def;
  return {
    fondo: v("--fondo-2", "#fff"),
    fondo3: v("--fondo-3", "#eee"),
    texto2: v("--texto-2", "#666"),
    borde: v("--borde", "#ddd"),
    acento: v("--acento", "#4f46e5"),
    ok: v("--ok", "#16a34a"),
    aviso: v("--aviso", "#d97706"),
    error: v("--error", "#dc2626"),
    ref: v("--ref", "#64748b"),
    usuario: v("--usuario", "#db2777"),
    omitida: v("--omitida", "#9ca3af"),
  };
}

function colorEstado(c: Colores, e: EstadoNota): string {
  switch (e) {
    case "afinada":
      return c.ok;
    case "aceptable":
      return c.aviso;
    case "desafinada":
      return c.error;
    default:
      return c.omitida;
  }
}

function rectRedondeado(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  if (typeof g.roundRect === "function") g.roundRect(x, y, w, h, Math.min(r, w / 2, h / 2));
  else g.rect(x, y, w, h);
}

export default function PianoRoll(props: PropsPianoRoll) {
  const {
    notas,
    contornoRef,
    contornoUsuario,
    resultados,
    tiempoActual,
    ventanaSeg = 8,
    ajustes,
    alto = 260,
    tolerancia,
    desplazarUsuario = 0,
    leyenda = true,
  } = props;

  const envoltorio = useRef<HTMLDivElement>(null);
  const lienzo = useRef<HTMLCanvasElement>(null);
  const [ancho, setAncho] = useState(0);
  const [tema, setTema] = useState(0);
  const colores = useRef<Colores | null>(null);
  const [zoom, setZoom] = useState(1);
  const [inicioVista, setInicioVista] = useState(0);
  const arrastre = useRef<{ x: number; inicio: number } | null>(null);

  const karaoke = tiempoActual !== undefined;

  // Tamaño responsive
  useEffect(() => {
    const el = envoltorio.current;
    if (!el) return;
    const ro = new ResizeObserver((e) => setAncho(Math.floor(e[0].contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Recalcular colores al cambiar el tema del sistema
  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!mq) return;
    const f = () => {
      colores.current = null;
      setTema((x) => x + 1);
    };
    mq.addEventListener("change", f);
    return () => mq.removeEventListener("change", f);
  }, []);

  const [minM, maxM] = useMemo(
    () => rangoMidi(notas, [contornoRef, notas.length || contornoRef?.length ? undefined : contornoUsuario]),
    [notas, contornoRef, contornoUsuario],
  );
  const total = useMemo(
    () => Math.max(1, duracionTotal(notas, [contornoRef, karaoke ? undefined : contornoUsuario])),
    [notas, contornoRef, contornoUsuario, karaoke],
  );

  const mapaResultados = useMemo(() => {
    const m = new Map<Nota, ResultadoNota>();
    if (resultados) for (const r of resultados) m.set(r.ref, r);
    return m;
  }, [resultados]);

  // Ventana visible
  const span = karaoke ? ventanaSeg : total / zoom;
  const inicio = karaoke
    ? (tiempoActual ?? 0) - span * 0.3
    : Math.min(Math.max(0, inicioVista), Math.max(0, total - span));

  useEffect(() => {
    const cv = lienzo.current;
    if (!cv || ancho <= 0) return;
    const dpr = window.devicePixelRatio || 1;
    const W = ancho;
    const H = alto;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) {
      cv.width = Math.round(W * dpr);
      cv.height = Math.round(H * dpr);
    }
    const g = cv.getContext("2d");
    if (!g) return;
    if (!colores.current) colores.current = leerColores(cv);
    const c = colores.current;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);

    const px = MARGEN.izq;
    const py = MARGEN.sup;
    const pw = Math.max(10, W - MARGEN.izq - MARGEN.der);
    const ph = Math.max(10, H - MARGEN.sup - MARGEN.inf);
    const filas = maxM - minM + 1;
    const altoFila = ph / filas;
    const xDe = (t: number) => px + ((t - inicio) / span) * pw;
    const yDe = (m: number) => py + (maxM - m + 0.5) * altoFila;
    const fin = inicio + span;
    const cfg = { la4: ajustes.la4, convencion: ajustes.convencion };

    // Filas (teclas negras sombreadas) y etiquetas de nota
    g.font = "10px system-ui, sans-serif";
    g.textBaseline = "middle";
    g.textAlign = "right";
    for (let m = minM; m <= maxM; m++) {
      const yTop = py + (maxM - m) * altoFila;
      if (esTeclaNegra(m)) {
        g.fillStyle = c.fondo3;
        g.globalAlpha = 0.6;
        g.fillRect(px, yTop, pw, altoFila);
        g.globalAlpha = 1;
      }
      if (m % 12 === 0) {
        g.strokeStyle = c.borde;
        g.lineWidth = 1;
        g.beginPath();
        g.moveTo(px, yTop + altoFila);
        g.lineTo(px + pw, yTop + altoFila);
        g.stroke();
      }
      const etiquetar =
        m % 12 === 0 || (altoFila >= 11 && !esTeclaNegra(m)) || (altoFila >= 16 && esTeclaNegra(m));
      if (etiquetar) {
        g.fillStyle = c.texto2;
        g.fillText(nombreNota(m, cfg), px - 6, yTop + altoFila / 2);
      }
    }

    // Eje de tiempo
    const paso = pasoMarcas(span, pw);
    g.textAlign = "center";
    g.textBaseline = "top";
    for (let t = Math.ceil(inicio / paso) * paso; t <= fin; t += paso) {
      if (t < 0) continue;
      const x = xDe(t);
      g.strokeStyle = c.borde;
      g.globalAlpha = 0.6;
      g.beginPath();
      g.moveTo(x, py);
      g.lineTo(x, py + ph);
      g.stroke();
      g.globalAlpha = 1;
      g.fillStyle = c.texto2;
      g.fillText(etiquetaTiempo(Math.round(t * 100) / 100), x, py + ph + 4);
    }

    g.save();
    g.beginPath();
    g.rect(px, py, pw, ph);
    g.clip();

    // Notas de referencia
    const altoBarra = Math.max(3, Math.min(altoFila * 0.8, 18));
    const actual = karaoke ? notaEn(notas, tiempoActual!) : null;
    for (const n of notas) {
      if (n.fin < inicio || n.inicio > fin) continue;
      const x1 = xDe(n.inicio);
      const w = Math.max(2, xDe(n.fin) - x1 - 1);
      const y = yDe(n.midi) - altoBarra / 2;
      const r = mapaResultados.get(n);
      rectRedondeado(g, x1, y, w, altoBarra, 4);
      if (r) {
        const col = colorEstado(c, r.estado);
        if (r.estado === "omitida") {
          g.setLineDash([4, 3]);
          g.strokeStyle = col;
          g.lineWidth = 1.5;
          g.stroke();
          g.setLineDash([]);
        } else {
          g.fillStyle = col;
          g.globalAlpha = 0.45;
          g.fill();
          g.globalAlpha = 1;
          g.strokeStyle = col;
          g.lineWidth = 1.5;
          g.stroke();
        }
      } else {
        g.fillStyle = n === actual ? c.acento : c.ref;
        g.globalAlpha = n === actual ? 0.55 : 0.3;
        g.fill();
        g.globalAlpha = 1;
        g.strokeStyle = n === actual ? c.acento : c.ref;
        g.lineWidth = 1;
        g.stroke();
      }
    }

    // Contornos
    const dibujarContorno = (
      cont: Contorno,
      grosor: number,
      colorBase: string,
      desplazar: number,
      colorear: boolean,
    ) => {
      g.lineWidth = grosor;
      g.lineJoin = "round";
      g.lineCap = "round";
      let i = Math.max(0, indiceDesde(cont, inicio - 0.1) - 1);
      let abierto = false;
      let colorActual = "";
      let prevT = -Infinity;
      let prevX = 0;
      let prevY = 0;
      const cerrar = () => {
        if (abierto) g.stroke();
        abierto = false;
      };
      for (; i < cont.length; i++) {
        const p = cont[i];
        if (p.t > fin + 0.1) break;
        if (p.midi == null || !Number.isFinite(p.midi)) {
          cerrar();
          prevT = -Infinity;
          continue;
        }
        const m = p.midi + desplazar;
        let col = colorBase;
        if (colorear && tolerancia) {
          const n = notaEn(notas, p.t);
          if (n) {
            const d = Math.abs(m - n.midi) * 100;
            col = d <= tolerancia.afinado ? c.ok : d <= tolerancia.aceptable ? c.aviso : c.error;
          }
        }
        const x = xDe(p.t);
        const y = yDe(m);
        const continuo = p.t - prevT <= 0.1;
        if (!continuo || col !== colorActual || !abierto) {
          cerrar();
          g.strokeStyle = col;
          colorActual = col;
          g.beginPath();
          if (continuo) g.moveTo(prevX, prevY);
          else g.moveTo(x, y);
          abierto = true;
        }
        g.lineTo(x, y);
        prevT = p.t;
        prevX = x;
        prevY = y;
      }
      cerrar();
    };

    if (contornoRef?.length) {
      g.globalAlpha = 0.85;
      dibujarContorno(contornoRef, 1.25, c.ref, 0, false);
      g.globalAlpha = 1;
    }
    if (contornoUsuario?.length) dibujarContorno(contornoUsuario, 2.5, c.usuario, desplazarUsuario, !!tolerancia);

    // Cursor
    if (karaoke) {
      const x = xDe(tiempoActual!);
      g.strokeStyle = c.acento;
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(x, py);
      g.lineTo(x, py + ph);
      g.stroke();
    }
    g.restore();
  }, [
    ancho,
    alto,
    tema,
    minM,
    maxM,
    inicio,
    span,
    notas,
    contornoRef,
    contornoUsuario,
    mapaResultados,
    tiempoActual,
    karaoke,
    ajustes.la4,
    ajustes.convencion,
    tolerancia,
    desplazarUsuario,
  ]);

  // Arrastre horizontal (solo fuera del modo karaoke y con zoom)
  const alPulsar = (e: PE<HTMLCanvasElement>) => {
    if (karaoke || zoom <= 1) return;
    arrastre.current = { x: e.clientX, inicio };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const alMover = (e: PE<HTMLCanvasElement>) => {
    const a = arrastre.current;
    if (!a) return;
    const pw = Math.max(10, ancho - MARGEN.izq - MARGEN.der);
    setInicioVista(a.inicio - ((e.clientX - a.x) / pw) * span);
  };
  const alSoltar = () => {
    arrastre.current = null;
  };

  const cambiarZoom = (factor: number) => {
    const nuevo = Math.min(64, Math.max(1, zoom * factor));
    const centro = inicio + span / 2;
    const nuevoSpan = total / nuevo;
    setZoom(nuevo);
    setInicioVista(centro - nuevoSpan / 2);
  };

  return (
    <div className="piano-roll">
      <div ref={envoltorio}>
        <canvas
          ref={lienzo}
          style={{ height: alto }}
          role="img"
          aria-label="Piano-roll con las notas de referencia y el contorno de pitch"
          onPointerDown={alPulsar}
          onPointerMove={alMover}
          onPointerUp={alSoltar}
          onPointerCancel={alSoltar}
        />
      </div>
      {!karaoke && (
        <div className="controles">
          <button className="boton boton-pequeno boton-icono" onClick={() => cambiarZoom(1 / 2)} disabled={zoom <= 1} aria-label="Alejar">
            −
          </button>
          <button className="boton boton-pequeno boton-icono" onClick={() => cambiarZoom(2)} disabled={zoom >= 64} aria-label="Acercar">
            +
          </button>
          {zoom > 1 && (
            <input
              type="range"
              min={0}
              max={Math.max(0, total - span)}
              step={0.01}
              value={inicio}
              onChange={(e) => setInicioVista(Number(e.target.value))}
              aria-label="Desplazar en el tiempo"
            />
          )}
          <span className="suave pequeno" style={{ whiteSpace: "nowrap" }}>
            {zoom > 1 ? `×${zoom}` : "Vista completa"}
          </span>
        </div>
      )}
      {leyenda && (
        <div className="leyenda">
          {!resultados && (
            <span>
              <i style={{ background: "var(--ref)", height: 8, opacity: 0.6 }} />
              Notas de referencia
            </span>
          )}
          {contornoRef?.length ? (
            <span>
              <i style={{ background: "var(--ref)", height: 2 }} />
              Contorno de referencia
            </span>
          ) : null}
          {contornoUsuario && (
            <span>
              <i style={{ background: "var(--usuario)" }} />
              Tu voz
            </span>
          )}
          {(resultados || tolerancia) && (
            <>
              <span>
                <i style={{ background: "var(--ok)" }} />
                Afinada
              </span>
              <span>
                <i style={{ background: "var(--aviso)" }} />
                Aceptable
              </span>
              <span>
                <i style={{ background: "var(--error)" }} />
                Desafinada
              </span>
              {resultados && (
                <span>
                  <i style={{ border: "1px dashed var(--omitida)", height: 8 }} />
                  Omitida
                </span>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
