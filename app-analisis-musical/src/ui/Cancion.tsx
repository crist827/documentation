// Pestaña "Canción": cargar y analizar la referencia, verla y escucharla.
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { analizarArchivo, tipoDeArchivo } from "../analisis/api";
import { obtenerContexto } from "../audio/contexto";
import {
  borrarReferencia,
  guardarReferencia,
  listarReferencias,
  obtenerArchivo,
  type ReferenciaGuardada,
} from "../db";
import { nombreNota } from "../notas";
import { duracionReferencia, notaEn } from "../referencia/fragmento";
import type { TipoReferencia } from "../tipos";
import { useApp } from "./estadoApp";
import { fmtFecha, fmtHz, fmtNotaConCents, fmtTiempo } from "./formato";
import PianoRoll from "./PianoRoll";
import { useReproduccion } from "./useReproduccion";

type TipoAudio = "acapella" | "cancion";

const NOMBRE_TIPO: Record<TipoReferencia, string> = {
  midi: "MIDI",
  acapella: "A cappella",
  cancion: "Canción completa",
};

export default function Cancion() {
  const { referencia, audio, origen, fijarReferencia, ajustes, irA } = useApp();
  const [tipoAudio, setTipoAudio] = useState<TipoAudio>(
    referencia?.tipo === "cancion" ? "cancion" : "acapella",
  );
  const [cargando, setCargando] = useState(false);
  const [progreso, setProgreso] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [encima, setEncima] = useState(false);
  const [guardadas, setGuardadas] = useState<ReferenciaGuardada[]>([]);
  const entrada = useRef<HTMLInputElement>(null);
  const rep = useReproduccion();
  const cfg = { la4: ajustes.la4, convencion: ajustes.convencion };

  const refrescar = useCallback(() => {
    listarReferencias()
      .then(setGuardadas)
      .catch(() => setGuardadas([]));
  }, []);
  useEffect(refrescar, [refrescar]);

  const procesar = async (archivo: File, pista?: number, tipo: TipoAudio = tipoAudio) => {
    setError(null);
    if (!tipoDeArchivo(archivo.name)) {
      setError(`Formato no soportado: “${archivo.name}”. Usa un MIDI (.mid) o un audio (.mp3, .wav, .ogg, .m4a, .flac).`);
      return;
    }
    rep.parar();
    setCargando(true);
    setProgreso(0);
    const anterior = referencia;
    try {
      const res = await analizarArchivo(archivo, { tipoAudio: tipo, pista, onProgreso: setProgreso });
      const pistaUsada = pista ?? res.pistaElegida;
      fijarReferencia(res.referencia, res.audio ?? null, { archivo, pistas: res.pistas, pista: pistaUsada });
      try {
        await guardarReferencia(res.referencia, { archivo, pistas: res.pistas, pista: pistaUsada });
        // al reanalizar el mismo archivo (otra pista u otro tipo) se sustituye la entrada anterior
        if (anterior && origen?.archivo === archivo && anterior.id !== res.referencia.id)
          await borrarReferencia(anterior.id);
      } catch {
        setError("La canción se analizó, pero no se pudo guardar en este navegador.");
      }
      refrescar();
    } catch (e) {
      setError((e as Error).message || String(e));
    } finally {
      setCargando(false);
    }
  };

  const alSoltar = (e: DragEvent) => {
    e.preventDefault();
    setEncima(false);
    const f = e.dataTransfer.files?.[0];
    if (f && !cargando) procesar(f);
  };

  const abrir = async (g: ReferenciaGuardada) => {
    setError(null);
    rep.parar();
    try {
      const archivo = await obtenerArchivo(g.id);
      let buf: AudioBuffer | null = null;
      if (g.tipo !== "midi" && archivo) {
        const ctx = await obtenerContexto();
        buf = await ctx.decodeAudioData(await archivo.arrayBuffer());
      }
      const { fecha: _f, nombreArchivo: _n, pistas, pista, ...ref } = g;
      fijarReferencia(ref, buf, { archivo, pistas, pista });
      if (g.tipo !== "midi") setTipoAudio(g.tipo === "cancion" ? "cancion" : "acapella");
    } catch (e) {
      setError(`No se pudo abrir la referencia: ${(e as Error).message}`);
    }
  };

  const borrar = async (g: ReferenciaGuardada) => {
    if (!confirm(`¿Borrar “${g.nombre}” de las referencias guardadas?`)) return;
    await borrarReferencia(g.id);
    if (referencia?.id === g.id) {
      rep.parar();
      fijarReferencia(null);
    }
    refrescar();
  };

  const duracion = referencia ? duracionReferencia(referencia) : 0;
  const rango = useMemo(() => {
    if (!referencia?.notas.length) return null;
    let lo = Infinity;
    let hi = -Infinity;
    for (const n of referencia.notas) {
      lo = Math.min(lo, n.midi);
      hi = Math.max(hi, n.midi);
    }
    return [lo, hi] as const;
  }, [referencia]);
  const notaSonando = referencia && rep.tiempo != null ? notaEn(referencia.notas, rep.tiempo) : null;
  const esAudio = origen?.archivo ? tipoDeArchivo(origen.archivo.name) === "audio" : false;

  return (
    <div className="pila">
      <section className="tarjeta pila">
        <h2>Cargar una canción de referencia</h2>
        <div
          className={`zona-carga${encima ? " encima" : ""}`}
          role="button"
          tabIndex={0}
          onClick={() => !cargando && entrada.current?.click()}
          onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && !cargando && entrada.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setEncima(true);
          }}
          onDragLeave={() => setEncima(false)}
          onDrop={alSoltar}
        >
          <p style={{ margin: 0 }}>
            <strong>Arrastra aquí un archivo</strong> o pulsa para elegirlo
          </p>
          <p className="pequeno" style={{ margin: "4px 0 0" }}>
            MIDI (.mid) · audio (.mp3, .wav, .ogg, .m4a, .flac). Todo se procesa en tu equipo.
          </p>
          <input
            ref={entrada}
            type="file"
            accept=".mid,.midi,.mp3,.wav,.ogg,.m4a,.flac,.webm,.aac,audio/*,audio/midi"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) procesar(f);
            }}
          />
        </div>

        <div className="campo">
          <span>Si es un audio, ¿qué contiene?</span>
          <div className="segmentado" role="radiogroup" aria-label="Tipo de audio">
            <button
              role="radio"
              aria-checked={tipoAudio === "acapella"}
              className={tipoAudio === "acapella" ? "activa" : ""}
              onClick={() => setTipoAudio("acapella")}
              disabled={cargando}
            >
              Voz sola (a cappella)
            </button>
            <button
              role="radio"
              aria-checked={tipoAudio === "cancion"}
              className={tipoAudio === "cancion" ? "activa" : ""}
              onClick={() => setTipoAudio("cancion")}
              disabled={cargando}
            >
              Canción completa
            </button>
          </div>
        </div>
        {tipoAudio === "cancion" && (
          <div className="aviso aviso-info">
            <p>
              Con la canción completa la melodía se estima sobre la mezcla y puede fallar con coros o solos
              instrumentales. Para un resultado mucho mejor, separa antes la voz con{" "}
              <strong>Demucs</strong> (gratis, en tu equipo o en Google Colab):
            </p>
            <p>
              <code>pip install demucs</code>
              <br />
              <code>demucs --two-stems=vocals cancion.mp3</code>
            </p>
            <p>
              Después carga <code>vocals.wav</code> como <em>voz sola</em>. En Practicar puedes usar{" "}
              <code>no_vocals.wav</code> como acompañamiento.
            </p>
          </div>
        )}

        {cargando && (
          <div className="pila" style={{ gap: 6 }} aria-live="polite">
            <div className="barra-progreso" role="progressbar" aria-valuenow={Math.round(progreso * 100)} aria-valuemin={0} aria-valuemax={100}>
              <div style={{ width: `${Math.round(progreso * 100)}%` }} />
            </div>
            <span className="suave pequeno">Analizando… {Math.round(progreso * 100)} %</span>
          </div>
        )}
        {error && <div className="aviso aviso-error">{error}</div>}
      </section>

      {referencia && (
        <section className="tarjeta pila">
          <div className="fila fila-entre">
            <div style={{ minWidth: 0 }}>
              <h2 style={{ marginBottom: 4, overflowWrap: "anywhere" }}>{referencia.nombre}</h2>
              <div className="fila">
                <span className="chip">{NOMBRE_TIPO[referencia.tipo]}</span>
                <span className="chip">{fmtTiempo(duracion)}</span>
                <span className="chip">{referencia.notas.length} notas</span>
                {rango && (
                  <span className="chip">
                    {nombreNota(rango[0], cfg)} – {nombreNota(rango[1], cfg)}
                  </span>
                )}
              </div>
            </div>
            <div className="fila">
              {rep.reproduciendo ? (
                <button className="boton" onClick={rep.parar}>
                  ■ Parar
                </button>
              ) : (
                <button className="boton" onClick={() => rep.iniciar({ audio: audio ?? undefined, notas: referencia.notas }, 0, { la4: ajustes.la4 })}>
                  ▶ Reproducir
                </button>
              )}
              <button className="boton boton-primario" onClick={() => irA("practicar")}>
                Practicar
              </button>
            </div>
          </div>

          {referencia.tipo !== "midi" && !audio && (
            <div className="aviso">No se guardó el audio original de esta referencia: se reproducirá la melodía sintetizada.</div>
          )}

          {origen?.pistas && origen.pistas.length > 1 && origen.archivo && (
            <label className="campo">
              <span>Pista del MIDI con la melodía</span>
              <select
                value={origen.pista ?? ""}
                disabled={cargando}
                onChange={(e) => {
                  const v = e.target.value;
                  procesar(origen.archivo!, v === "" ? undefined : Number(v));
                }}
              >
                <option value="">Automática (la más melódica)</option>
                {origen.pistas.map((p) => (
                  <option key={p.indice} value={p.indice}>
                    {p.nombre} · {p.numNotas} notas · {nombreNota(p.alturaMedia, cfg)} de media
                    {p.polifonia > 0.2 ? " · polifónica" : ""}
                  </option>
                ))}
              </select>
            </label>
          )}

          {esAudio && origen?.archivo && referencia.tipo !== tipoAudio && (
            <div className="fila">
              <button className="boton" disabled={cargando} onClick={() => procesar(origen.archivo!, undefined, tipoAudio)}>
                Reanalizar como {tipoAudio === "cancion" ? "canción completa" : "voz sola"}
              </button>
            </div>
          )}

          <PianoRoll
            notas={referencia.notas}
            contornoRef={referencia.contorno}
            tiempoActual={rep.tiempo ?? undefined}
            ajustes={ajustes}
          />

          <details>
            <summary style={{ cursor: "pointer", fontWeight: 600 }}>Tabla de notas ({referencia.notas.length})</summary>
            <div className="tabla-contenedor alta" style={{ marginTop: 8 }}>
              <table className="tabla">
                <thead>
                  <tr>
                    <th className="der">#</th>
                    <th>Inicio</th>
                    <th>Nota</th>
                    <th className="der">Frecuencia</th>
                    <th className="der">Duración</th>
                  </tr>
                </thead>
                <tbody>
                  {referencia.notas.map((n, i) => (
                    <tr key={i} className={n === notaSonando ? "fila-activa" : undefined}>
                      <td className="der suave">{i + 1}</td>
                      <td>{fmtTiempo(n.inicio)}</td>
                      <td>{fmtNotaConCents(n.midi, cfg)}</td>
                      <td className="der">{fmtHz(n.hz)}</td>
                      <td className="der">{(n.fin - n.inicio).toFixed(2)} s</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </section>
      )}

      <section className="tarjeta">
        <h2>Referencias guardadas</h2>
        {guardadas.length === 0 ? (
          <p className="suave" style={{ margin: 0 }}>
            Aún no hay referencias. Las canciones que analices se guardan en este navegador.
          </p>
        ) : (
          <ul className="lista">
            {guardadas.map((g) => (
              <li key={g.id}>
                <div className="crece">
                  <strong>{g.nombre}</strong>
                  <div className="suave pequeno">
                    {NOMBRE_TIPO[g.tipo]} · {g.notas.length} notas · {fmtFecha(g.fecha)}
                  </div>
                </div>
                {referencia?.id === g.id ? (
                  <span className="chip chip-ok">Abierta</span>
                ) : (
                  <button className="boton boton-pequeno" onClick={() => abrir(g)}>
                    Abrir
                  </button>
                )}
                <button className="boton boton-pequeno boton-peligro" onClick={() => borrar(g)} aria-label={`Borrar ${g.nombre}`}>
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
