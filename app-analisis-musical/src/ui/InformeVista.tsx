// Pestaña "Informe": puntuación, consejos, métricas, gráfica y tabla por nota.
import { useMemo, useState } from "react";
import { TOLERANCIAS, type EstadoNota, type ResultadoNota } from "../tipos";
import { nombreNota } from "../notas";
import { useApp } from "./estadoApp";
import {
  conSigno,
  describirSesgo,
  fmtCents,
  fmtFecha,
  fmtMs,
  fmtNotaConCents,
  fmtPct,
  fmtTiempo,
} from "./formato";
import PianoRoll from "./PianoRoll";

const ESTADOS: Record<EstadoNota, { texto: string; clase: string }> = {
  afinada: { texto: "Afinada", clase: "chip chip-ok" },
  aceptable: { texto: "Aceptable", clase: "chip chip-aviso" },
  desafinada: { texto: "Desafinada", clase: "chip chip-error" },
  omitida: { texto: "Omitida", clase: "chip" },
};

function claseValor(v: number): "ok" | "aviso" | "error" {
  return v >= 80 ? "ok" : v >= 60 ? "aviso" : "error";
}

function Metrica({ etiqueta, valor, detalle, clase }: { etiqueta: string; valor: string; detalle?: string; clase?: string }) {
  return (
    <div className="metrica">
      <span className="etiqueta">{etiqueta}</span>
      <div className={`valor${clase ? ` ${clase}` : ""}`}>{valor}</div>
      {detalle && <div className="detalle">{detalle}</div>}
    </div>
  );
}

export default function InformeVista() {
  const { informe, referencia, ajustes, irA } = useApp();
  const [soloMal, setSoloMal] = useState(false);
  const cfg = { la4: ajustes.la4, convencion: ajustes.convencion };

  const notas = useMemo(() => informe?.resultados.map((r) => r.ref) ?? [], [informe]);
  const filas = useMemo(() => {
    if (!informe) return [];
    const todas = informe.resultados.map((r, i) => ({ r, i }));
    return soloMal ? todas.filter(({ r }) => r.estado === "desafinada" || r.estado === "omitida") : todas;
  }, [informe, soloMal]);

  if (!informe) {
    return (
      <div className="tarjeta vacio">
        <h2>Aún no hay informe</h2>
        <p>Canta una canción en la pestaña Practicar y aquí verás el análisis detallado.</p>
        <button className="boton boton-primario" onClick={() => irA("practicar")}>
          Ir a Practicar
        </button>
      </div>
    );
  }

  const m = informe.metricas;
  const tol = TOLERANCIAS[informe.opciones.nivel];
  const consejos = [...informe.consejos].sort((a, b) => b.gravedad - a.gravedad).slice(0, 3);
  const contornoRef = referencia?.id === informe.referenciaId ? referencia.contorno : undefined;
  const desglose: [string, number][] = [
    ["Afinación", informe.desglose.afinacion],
    ["Estabilidad", informe.desglose.estabilidad],
    ["Ritmo", informe.desglose.ritmo],
    ["Ataques", informe.desglose.ataques],
  ];
  const oct = informe.desplazamientoOctava;
  const cantadas = informe.resultados.filter((r) => r.estado !== "omitida").length;

  return (
    <div className="pila">
      <section className="tarjeta pila">
        <div className="fila fila-entre">
          <div style={{ minWidth: 0 }}>
            <h2 style={{ marginBottom: 2, overflowWrap: "anywhere" }}>{informe.referenciaNombre}</h2>
            <span className="suave pequeno">
              {fmtFecha(informe.fecha)} · {informe.opciones.modo === "sincronizado" ? "Sincronizado" : "Libre"} · nivel{" "}
              {informe.opciones.nivel}
            </span>
          </div>
          <button className="boton" onClick={() => irA("practicar")}>
            Volver a practicar
          </button>
        </div>

        <div className="puntuacion">
          <div className={`puntuacion-numero color-${claseValor(informe.puntuacion)}`} aria-label={`Puntuación ${informe.puntuacion} de 100`}>
            {informe.puntuacion}
            <small> / 100</small>
          </div>
          <div className="desglose">
            {desglose.map(([nombre, v]) => (
              <div key={nombre} style={{ display: "contents" }}>
                <span>{nombre}</span>
                <div className="barra" role="meter" aria-valuenow={v} aria-valuemin={0} aria-valuemax={100} aria-label={nombre}>
                  <div className={`fondo-${claseValor(v)}`} style={{ width: `${Math.max(0, Math.min(100, v))}%` }} />
                </div>
                <span className="num">{Math.round(v)}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="fila">
          {informe.opciones.modo === "sincronizado" ? (
            <span className="chip">
              Latencia compensada: {Math.round(informe.latenciaMs)} ms
              {informe.opciones.latenciaMs == null ? " (automática)" : " (manual)"}
            </span>
          ) : (
            <span className="chip">Alineación temporal automática (DTW)</span>
          )}
          {oct !== 0 && (
            <span className="chip">
              Octava corregida: cantaste {Math.abs(oct)} {Math.abs(oct) === 1 ? "octava" : "octavas"}{" "}
              {oct < 0 ? "por debajo" : "por encima"}
            </span>
          )}
          {informe.opciones.transposicion !== 0 && (
            <span className="chip">Transposición: {conSigno(informe.opciones.transposicion)} semitonos</span>
          )}
          <span className="chip">
            {cantadas} de {informe.resultados.length} notas cantadas
          </span>
        </div>
      </section>

      {consejos.length > 0 && (
        <section className="tarjeta">
          <h2>Consejos</h2>
          <div className="consejos">
            {consejos.map((c) => (
              <div className="consejo" key={c.id}>
                <h3>{c.titulo}</h3>
                <p>{c.mensaje}</p>
                <p className="ejercicio">
                  <strong>Ejercicio:</strong> {c.ejercicio}
                </p>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="rejilla-metricas" aria-label="Métricas">
        <Metrica
          etiqueta="Error medio"
          valor={`${Math.round(m.errorMedioCents)} c`}
          clase={m.errorMedioCents <= tol.afinado ? "color-ok" : m.errorMedioCents <= tol.aceptable ? "color-aviso" : "color-error"}
          detalle={`objetivo ≤ ${tol.afinado} c`}
        />
        <Metrica etiqueta="Sesgo" valor={fmtCents(m.sesgoCents)} detalle={describirSesgo(m.sesgoCents)} />
        <Metrica
          etiqueta="Notas afinadas"
          valor={fmtPct(m.pctNotasAfinadas)}
          detalle={m.pctNotasOmitidas > 0 ? `${fmtPct(m.pctNotasOmitidas)} omitidas` : "ninguna omitida"}
        />
        <Metrica
          etiqueta="Estabilidad"
          valor={`${Math.round(m.estabilidadCents)} c`}
          detalle={`deriva ${conSigno(m.derivaCentsPorSeg)} c/s`}
        />
        <Metrica
          etiqueta="Entradas"
          valor={fmtMs(m.retrasoEntradaMedioMs)}
          detalle={`${m.retrasoEntradaMedioMs > 0 ? "tarde" : "pronto"} · dispersión ${Math.round(m.dispersionEntradaMs)} ms`}
        />
        <Metrica
          etiqueta="Ataques"
          valor={`${Math.round(m.ataqueMedioMs)} ms`}
          detalle={`${fmtPct(m.pctScoop)} desde abajo`}
        />
        <Metrica
          etiqueta="Duración de notas"
          valor={`${Math.round(m.duracionRelativa * 100)} %`}
          detalle="de la duración de referencia"
        />
        <Metrica
          etiqueta="Vibrato"
          valor={m.vibratoMedio ? `${m.vibratoMedio.hz.toFixed(1)} Hz` : "—"}
          detalle={m.vibratoMedio ? `±${Math.round(m.vibratoMedio.amplitudCents)} c` : "no detectado"}
        />
      </section>

      <section className="tarjeta pila">
        <h2 style={{ margin: 0 }}>Tu voz frente a la referencia</h2>
        <PianoRoll
          notas={notas}
          contornoRef={contornoRef}
          contornoUsuario={informe.contornoUsuario}
          resultados={informe.resultados}
          tolerancia={tol}
          ajustes={ajustes}
          alto={300}
        />
        <p className="suave pequeno" style={{ margin: 0 }}>
          Tu voz se muestra ya alineada en el tiempo{oct !== 0 || informe.opciones.transposicion !== 0 ? " y corregida de octava/transposición" : ""}.
          Registro — grave: {Math.round(m.errorPorRegistro.grave)} c · medio: {Math.round(m.errorPorRegistro.medio)} c · agudo:{" "}
          {Math.round(m.errorPorRegistro.agudo)} c. Saltos: {Math.round(m.errorSaltosCents)} c · grados conjuntos:{" "}
          {Math.round(m.errorGradosConjuntosCents)} c.
        </p>
      </section>

      <section className="tarjeta pila">
        <div className="fila fila-entre">
          <h2 style={{ margin: 0 }}>Nota a nota</h2>
          <label className="casilla pequeno">
            <input type="checkbox" checked={soloMal} onChange={(e) => setSoloMal(e.target.checked)} />
            Solo desafinadas y omitidas
          </label>
        </div>
        {filas.length === 0 ? (
          <p className="suave" style={{ margin: 0 }}>
            ¡Ninguna nota desafinada!
          </p>
        ) : (
          <div className="tabla-contenedor alta">
            <table className="tabla">
              <thead>
                <tr>
                  <th className="der">#</th>
                  <th>Tiempo</th>
                  <th>Esperada</th>
                  <th>Cantada</th>
                  <th className="der">Diferencia</th>
                  <th className="der">Entrada</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {filas.map(({ r, i }) => (
                  <FilaNota key={i} r={r} i={i} cfg={cfg} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function FilaNota({ r, i, cfg }: { r: ResultadoNota; i: number; cfg: { la4: number; convencion: "cientifica" | "hispana" } }) {
  const omitida = r.estado === "omitida" || !r.cantada;
  const e = ESTADOS[r.estado];
  return (
    <tr>
      <td className="der suave">{i + 1}</td>
      <td>{fmtTiempo(r.ref.inicio)}</td>
      <td>
        <strong>{nombreNota(r.ref.midi, cfg)}</strong>
      </td>
      <td>{omitida ? "—" : fmtNotaConCents(r.cantada!.midi, cfg)}</td>
      <td className="der">
        {omitida ? (
          "—"
        ) : (
          <>
            {fmtCents(r.desvioCents)} <span className="suave">/ {conSigno(r.desvioHz, 1)} Hz</span>
          </>
        )}
      </td>
      <td className="der">{omitida ? "—" : fmtMs(r.retrasoEntradaMs)}</td>
      <td>
        <span className={e.clase}>{e.texto}</span>
      </td>
    </tr>
  );
}
