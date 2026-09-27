// Pestaña "Progreso": sesiones guardadas y evolución de la puntuación.
import { useEffect, useMemo, useRef, useState } from "react";
import { borrarSesion, listarSesiones, type Sesion } from "../db";
import { useApp } from "./estadoApp";
import { fmtFecha } from "./formato";

const ALTO = 220;
const M = { izq: 34, der: 16, sup: 12, inf: 26 };

export default function Progreso() {
  const { irA } = useApp();
  const [sesiones, setSesiones] = useState<Sesion[] | null>(null);
  const [filtro, setFiltro] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  const cargar = () =>
    listarSesiones()
      .then(setSesiones)
      .catch(() => {
        setSesiones([]);
        setError("No se pudo leer el historial de este navegador.");
      });
  useEffect(() => {
    cargar();
  }, []);

  const canciones = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of sesiones ?? []) m.set(s.referenciaId, s.referenciaNombre);
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [sesiones]);

  const visibles = useMemo(
    () => (sesiones ?? []).filter((s) => !filtro || s.referenciaId === filtro),
    [sesiones, filtro],
  );

  if (sesiones === null) return <p className="suave">Cargando historial…</p>;

  if (sesiones.length === 0) {
    return (
      <div className="tarjeta vacio">
        <h2>Todavía no hay sesiones</h2>
        <p>Cada práctica que evalúes se guarda aquí para que veas tu evolución.</p>
        {error && <div className="aviso aviso-error">{error}</div>}
        <button className="boton boton-primario" onClick={() => irA("practicar")}>
          Ir a Practicar
        </button>
      </div>
    );
  }

  const puntos = visibles.map((s) => s.puntuacion);
  const ultimas = puntos.slice(-5);
  const media = ultimas.length ? Math.round(ultimas.reduce((a, b) => a + b, 0) / ultimas.length) : 0;

  const borrar = async (s: Sesion) => {
    if (s.id == null || !confirm("¿Borrar esta sesión del historial?")) return;
    await borrarSesion(s.id);
    cargar();
  };

  return (
    <div className="pila">
      <section className="tarjeta pila">
        <div className="fila fila-entre">
          <h2 style={{ margin: 0 }}>Tu progreso</h2>
          <select value={filtro} onChange={(e) => setFiltro(e.target.value)} aria-label="Filtrar por canción">
            <option value="">Todas las canciones</option>
            {canciones.map(([id, nombre]) => (
              <option key={id} value={id}>
                {nombre}
              </option>
            ))}
          </select>
        </div>

        <div className="rejilla-metricas">
          <div className="metrica">
            <span className="etiqueta">Sesiones</span>
            <div className="valor">{visibles.length}</div>
          </div>
          <div className="metrica">
            <span className="etiqueta">Última</span>
            <div className="valor">{puntos.length ? puntos[puntos.length - 1] : "—"}</div>
          </div>
          <div className="metrica">
            <span className="etiqueta">Mejor</span>
            <div className="valor">{puntos.length ? Math.max(...puntos) : "—"}</div>
          </div>
          <div className="metrica">
            <span className="etiqueta">Media (últimas 5)</span>
            <div className="valor">{ultimas.length ? media : "—"}</div>
          </div>
        </div>

        {visibles.length > 0 && <Grafica sesiones={visibles} />}
      </section>

      <section className="tarjeta pila">
        <h2 style={{ margin: 0 }}>Sesiones</h2>
        <div className="tabla-contenedor alta">
          <table className="tabla">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Canción</th>
                <th className="der">Puntuación</th>
                <th className="der">Afinación</th>
                <th className="der">Estabilidad</th>
                <th className="der">Ritmo</th>
                <th className="der">Ataques</th>
                <th className="der">Error medio</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {[...visibles].reverse().map((s) => (
                <tr key={s.id}>
                  <td>{fmtFecha(s.fecha)}</td>
                  <td style={{ maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis" }}>{s.referenciaNombre}</td>
                  <td className="der">
                    <strong>{s.puntuacion}</strong>
                  </td>
                  <td className="der">{s.desglose.afinacion}</td>
                  <td className="der">{s.desglose.estabilidad}</td>
                  <td className="der">{s.desglose.ritmo}</td>
                  <td className="der">{s.desglose.ataques}</td>
                  <td className="der">{Math.round(s.metricas.errorMedioCents)} c</td>
                  <td>
                    <button className="boton boton-pequeno boton-peligro" onClick={() => borrar(s)} aria-label="Borrar sesión">
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

/** Gráfica de líneas (SVG) de la puntuación y la afinación por sesión, en una sola escala 0–100. */
function Grafica({ sesiones }: { sesiones: Sesion[] }) {
  const cont = useRef<HTMLDivElement>(null);
  const [ancho, setAncho] = useState(600);
  const [activo, setActivo] = useState<number | null>(null);

  useEffect(() => {
    const el = cont.current;
    if (!el) return;
    const ro = new ResizeObserver((e) => setAncho(Math.max(240, Math.floor(e[0].contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const n = sesiones.length;
  const pw = ancho - M.izq - M.der;
  const ph = ALTO - M.sup - M.inf;
  const x = (i: number) => M.izq + (n === 1 ? pw / 2 : (i / (n - 1)) * pw);
  const y = (v: number) => M.sup + (1 - Math.max(0, Math.min(100, v)) / 100) * ph;
  const linea = (vals: number[]) => vals.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
  const punt = sesiones.map((s) => s.puntuacion);
  const afin = sesiones.map((s) => s.desglose.afinacion);
  const paso = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(pw / 90))));
  const s = activo != null ? sesiones[activo] : null;

  return (
    <div>
      <div className="leyenda" style={{ marginTop: 0, marginBottom: 6 }}>
        <span>
          <i style={{ background: "var(--serie-1)", height: 3 }} />
          Puntuación global
        </span>
        <span>
          <i style={{ background: "repeating-linear-gradient(90deg, var(--serie-2) 0 5px, transparent 5px 8px)", height: 3 }} />
          Afinación
        </span>
      </div>
      <div className="grafica" ref={cont}>
      <svg
        viewBox={`0 0 ${ancho} ${ALTO}`}
        role="img"
        aria-label={`Evolución de la puntuación en ${n} sesiones`}
        onMouseLeave={() => setActivo(null)}
      >
        {[0, 25, 50, 75, 100].map((v) => (
          <g key={v}>
            <line x1={M.izq} x2={M.izq + pw} y1={y(v)} y2={y(v)} stroke="var(--borde)" strokeWidth={1} />
            <text x={M.izq - 6} y={y(v)} textAnchor="end" dominantBaseline="middle">
              {v}
            </text>
          </g>
        ))}
        {sesiones.map((ses, i) =>
          i % paso === 0 || i === n - 1 ? (
            <text key={ses.id ?? i} x={x(i)} y={ALTO - 6} textAnchor="middle">
              {new Date(ses.fecha).toLocaleDateString("es", { day: "numeric", month: "short" })}
            </text>
          ) : null,
        )}
        {activo != null && (
          <line x1={x(activo)} x2={x(activo)} y1={M.sup} y2={M.sup + ph} stroke="var(--texto-2)" strokeWidth={1} strokeDasharray="3 3" />
        )}
        {n > 1 && (
          <>
            <path d={linea(afin)} fill="none" stroke="var(--serie-2)" strokeWidth={2} strokeDasharray="6 4" strokeLinejoin="round" />
            <path d={linea(punt)} fill="none" stroke="var(--serie-1)" strokeWidth={2} strokeLinejoin="round" />
          </>
        )}
        {afin.map((v, i) => (
          <rect
            key={`a${i}`}
            x={x(i) - 4}
            y={y(v) - 4}
            width={8}
            height={8}
            rx={1.5}
            fill="var(--serie-2)"
            stroke="var(--fondo-2)"
            strokeWidth={2}
          />
        ))}
        {punt.map((v, i) => (
          <circle key={`p${i}`} cx={x(i)} cy={y(v)} r={activo === i ? 5.5 : 4.5} fill="var(--serie-1)" stroke="var(--fondo-2)" strokeWidth={2} />
        ))}
        {/* etiqueta directa del último valor */}
        <text x={x(n - 1)} y={y(punt[n - 1]) - 10} textAnchor={n === 1 ? "middle" : "end"} style={{ fill: "var(--texto)", fontWeight: 600 }}>
          {punt[n - 1]}
        </text>
        {/* zonas de captura por sesión, más anchas que las marcas */}
        {sesiones.map((ses, i) => {
          const w = n === 1 ? pw : pw / (n - 1);
          return (
            <rect
              key={`h${ses.id ?? i}`}
              x={x(i) - w / 2}
              y={M.sup}
              width={w}
              height={ph}
              fill="transparent"
              onMouseEnter={() => setActivo(i)}
              onClick={() => setActivo(i)}
            />
          );
        })}
      </svg>
      {s && activo != null && (
        <div className="tooltip" style={{ left: `${(x(activo) / ancho) * 100}%`, top: y(Math.max(punt[activo], afin[activo])) }}>
          <div className="suave">{fmtFecha(s.fecha)}</div>
          <div style={{ maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis" }}>{s.referenciaNombre}</div>
          <div>
            Puntuación <strong>{s.puntuacion}</strong> · Afinación <strong>{s.desglose.afinacion}</strong>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}
