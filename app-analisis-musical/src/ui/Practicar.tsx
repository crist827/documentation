// Pestaña "Practicar": cantar con la canción (karaoke) o grabar libre y comparar.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMicPitch } from "../audio/useMicPitch";
import { obtenerContexto } from "../audio/contexto";
import { comparar } from "../comparacion/comparar";
import { guardarSesion } from "../db";
import { nombreNota } from "../notas";
import {
  desplazarContorno,
  duracionReferencia,
  normalizarFragmento,
  notaEn,
  octavaEnVivo,
  recortarReferencia,
  type Fragmento,
} from "../referencia/fragmento";
import { reproducir, type Reproduccion } from "../referencia/reproductor";
import { TOLERANCIAS, type Contorno, type OpcionesComparacion } from "../tipos";
import { useApp } from "./estadoApp";
import { fmtCents, fmtNotaConCents, fmtTiempo } from "./formato";
import PianoRoll from "./PianoRoll";
import { useReproduccion } from "./useReproduccion";

type Modo = OpcionesComparacion["modo"];
type Fase = "inactivo" | "preparando" | "grabando" | "analizando";

const PULSO_SEG = 0.6;
const CLICS = 4;
const MAX_LIBRE_SEG = 600;

interface SesionEnCurso {
  ctx: AudioContext;
  t0: number;
  /** Tiempo de la referencia que corresponde a t0. */
  desde: number;
  /** Fin del fragmento (tiempo de la referencia) o null en modo libre. */
  hasta: number | null;
  rep: Reproduccion | null;
  raf: number;
  modo: Modo;
}

function numeroONull(txt: string): number | null {
  if (txt.trim() === "") return null;
  const v = Number(txt.replace(",", "."));
  return Number.isFinite(v) ? v : null;
}

export default function Practicar() {
  const { referencia, audio, ajustes, irA, fijarInforme } = useApp();
  const mic = useMicPitch();
  const { iniciarGrabacion, detenerGrabacion, detener: detenerMic } = mic;
  const escucha = useReproduccion();

  const [modo, setModo] = useState<Modo>("sincronizado");
  const [fragIni, setFragIni] = useState("");
  const [fragFin, setFragFin] = useState("");
  const [cuentaAtras, setCuentaAtras] = useState(true);
  const [acomp, setAcomp] = useState<{ nombre: string; buf: AudioBuffer } | null>(null);
  const [fase, setFase] = useState<Fase>("inactivo");
  const [error, setError] = useState<string | null>(null);
  const [tiempo, setTiempo] = useState(0);
  const [restante, setRestante] = useState(0);
  const [vivo, setVivo] = useState<Contorno>([]);

  const sesion = useRef<SesionEnCurso | null>(null);
  const vivoRef = useRef<Contorno>([]);
  const ultimoT = useRef(-Infinity);

  const duracion = referencia ? duracionReferencia(referencia) : 0;
  const fragmento: Fragmento | null = useMemo(
    () => normalizarFragmento(numeroONull(fragIni), numeroONull(fragFin), duracion),
    [fragIni, fragFin, duracion],
  );
  const notasVista = useMemo(
    () => (referencia ? (fragmento ? recortarReferencia(referencia, fragmento).notas : referencia.notas) : []),
    [referencia, fragmento],
  );
  const tol = TOLERANCIAS[ajustes.nivel];
  const cfg = { la4: ajustes.la4, convencion: ajustes.convencion };

  // --- Terminar y comparar ---
  const terminar = useCallback(() => {
    const s = sesion.current;
    if (!s || !referencia) return;
    sesion.current = null;
    cancelAnimationFrame(s.raf);
    s.rep?.parar();
    const tParada = s.ctx.currentTime - s.t0 + s.desde;
    const contorno = detenerGrabacion();
    detenerMic();
    setFase("analizando");

    const conVoz = contorno.filter((p) => p.midi != null).length;
    if (conVoz < 20) {
      setError("No se detectó tu voz. Comprueba el micrófono y canta un poco más fuerte o más cerca.");
      setFase("inactivo");
      return;
    }
    // En modo sincronizado, si se para antes, solo se evalúa lo cantado.
    const fin = s.modo === "sincronizado" ? Math.min(s.hasta ?? duracion, tParada) : (s.hasta ?? duracion);
    const recorte = s.desde > 0 || fin < duracion ? { inicio: s.desde, fin } : null;
    if (recorte && recorte.fin - recorte.inicio < 1) {
      setError("La grabación es demasiado corta para compararla.");
      setFase("inactivo");
      return;
    }
    const ref = recorte ? recortarReferencia(referencia, recorte) : referencia;
    if (ref.notas.length === 0) {
      setError("El tramo grabado no contiene notas de la referencia.");
      setFase("inactivo");
      return;
    }
    const usuario = desplazarContorno(contorno, s.desde);

    // Se deja pintar "Analizando…" antes del cálculo
    setTimeout(() => {
      try {
        const informe = comparar(ref, usuario, {
          nivel: ajustes.nivel,
          corregirOctava: ajustes.corregirOctava,
          transposicion: ajustes.transposicion,
          modo: s.modo,
          latenciaMs: ajustes.latenciaManualMs ?? undefined,
        });
        fijarInforme(informe);
        guardarSesion(informe).catch(() => {
          /* sin IndexedDB: el informe se muestra igualmente */
        });
        setFase("inactivo");
        irA("informe");
      } catch (e) {
        setError(`No se pudo comparar la grabación: ${(e as Error).message}`);
        setFase("inactivo");
      }
    }, 30);
  }, [detenerGrabacion, detenerMic, referencia, duracion, ajustes, fijarInforme, irA]);

  // --- Arrancar cuando el micrófono esté listo ---
  const arrancar = useCallback(async () => {
    if (!referencia) return;
    const ctx = await obtenerContexto();
    const clics = cuentaAtras ? CLICS : 0;
    const t0 = ctx.currentTime + 0.5 + clics * PULSO_SEG;
    const desde = fragmento?.inicio ?? 0;
    const hasta = fragmento?.fin ?? duracion;
    vivoRef.current = [];
    ultimoT.current = t0;
    setVivo([]);
    iniciarGrabacion(t0);

    let rep: Reproduccion;
    if (modo === "sincronizado") {
      rep = reproducir(
        ctx,
        { audio: acomp?.buf ?? audio ?? undefined, notas: referencia.notas },
        t0,
        desde,
        { hasta, clics, pulsoSeg: PULSO_SEG, la4: ajustes.la4, transponer: ajustes.transposicion },
      );
    } else {
      rep = reproducir(ctx, { notas: [] }, t0, 0, { clics, pulsoSeg: PULSO_SEG });
    }
    const s: SesionEnCurso = {
      ctx,
      t0,
      desde,
      hasta: modo === "sincronizado" ? desde + (rep.fin - t0) : fragmento ? hasta : null,
      rep,
      raf: 0,
      modo,
    };
    sesion.current = s;
    setFase("grabando");

    const paso = () => {
      if (sesion.current !== s) return;
      const ahora = ctx.currentTime;
      setTiempo(ahora - t0 + desde);
      setRestante(t0 - ahora);
      if (modo === "sincronizado" && ahora >= rep.fin + 0.4) return terminar();
      if (modo === "libre" && ahora - t0 > MAX_LIBRE_SEG) return terminar();
      s.raf = requestAnimationFrame(paso);
    };
    s.raf = requestAnimationFrame(paso);
  }, [referencia, cuentaAtras, fragmento, duracion, iniciarGrabacion, modo, acomp, audio, ajustes.la4, ajustes.transposicion, terminar]);

  const arrancando = useRef(false);
  useEffect(() => {
    if (fase !== "preparando") {
      arrancando.current = false;
      return;
    }
    if (mic.error) setFase("inactivo");
    else if (mic.activo && !arrancando.current) {
      arrancando.current = true;
      arrancar().catch((e) => {
        setError(`No se pudo iniciar la práctica: ${(e as Error).message}`);
        setFase("inactivo");
      });
    }
  }, [fase, mic.activo, mic.error, arrancar]);

  // Contorno en vivo (tiempo de la referencia) a partir del historial del micrófono
  useEffect(() => {
    const s = sesion.current;
    if (fase !== "grabando" || !s) return;
    let nuevos = false;
    for (const p of mic.historial) {
      if (p.t <= ultimoT.current) continue;
      ultimoT.current = p.t;
      vivoRef.current.push({ t: p.t - s.t0 + s.desde, midi: p.midi, claridad: p.claridad });
      nuevos = true;
    }
    if (nuevos) setVivo(vivoRef.current.slice());
  }, [mic.historial, fase]);

  // Al salir de la pestaña: parar todo
  useEffect(
    () => () => {
      const s = sesion.current;
      sesion.current = null;
      if (s) {
        cancelAnimationFrame(s.raf);
        s.rep?.parar();
      }
    },
    [],
  );

  const empezar = async () => {
    setError(null);
    escucha.parar();
    setFase("preparando");
    await mic.iniciar();
  };

  const cancelar = () => {
    const s = sesion.current;
    sesion.current = null;
    if (s) {
      cancelAnimationFrame(s.raf);
      s.rep?.parar();
    }
    detenerGrabacion();
    detenerMic();
    setFase("inactivo");
  };

  const cargarAcomp = async (f: File) => {
    try {
      const ctx = await obtenerContexto();
      const buf = await ctx.decodeAudioData(await f.arrayBuffer());
      setAcomp({ nombre: f.name, buf });
    } catch {
      setError("No se pudo leer el audio de acompañamiento.");
    }
  };

  if (!referencia) {
    return (
      <div className="tarjeta vacio">
        <h2>Primero elige una canción</h2>
        <p>Para practicar necesitas una referencia (MIDI o audio).</p>
        <button className="boton boton-primario" onClick={() => irA("cancion")}>
          Ir a Canción
        </button>
      </div>
    );
  }

  const enCurso = fase === "grabando" || fase === "preparando";
  const esperada = fase === "grabando" && modo === "sincronizado" ? notaEn(referencia.notas, tiempo) : null;
  const octava =
    fase === "grabando" && ajustes.corregirOctava
      ? octavaEnVivo(vivo, referencia.notas, tiempo - 4, ajustes.transposicion)
      : 0;
  const desplazar = -ajustes.transposicion - 12 * octava;
  const cantadaMidi = mic.ultimo?.midi ?? null;
  const difCents =
    esperada && cantadaMidi != null ? Math.round((cantadaMidi + desplazar - esperada.midi) * 100) : null;
  const claseDif =
    difCents == null
      ? ""
      : Math.abs(difCents) <= tol.afinado
        ? "color-ok"
        : Math.abs(difCents) <= tol.aceptable
          ? "color-aviso"
          : "color-error";
  const cuenta = fase === "grabando" && restante > 0 ? Math.ceil(restante / PULSO_SEG) : 0;

  return (
    <div className="pila">
      <div className="aviso">
        <strong>🎧 Usa auriculares.</strong> Sin ellos el micrófono capta la canción y la app acaba siguiendo al
        cantante original en lugar de a ti.
      </div>

      <section className="tarjeta pila">
        <div className="fila fila-entre">
          <h2 style={{ margin: 0, overflowWrap: "anywhere" }}>{referencia.nombre}</h2>
          <span className="chip">{fmtTiempo(duracion)}</span>
        </div>

        <div className="segmentado" role="radiogroup" aria-label="Modo de práctica">
          <button
            role="radio"
            aria-checked={modo === "sincronizado"}
            className={modo === "sincronizado" ? "activa" : ""}
            onClick={() => setModo("sincronizado")}
            disabled={enCurso}
          >
            Cantar con la canción (sincronizado)
          </button>
          <button
            role="radio"
            aria-checked={modo === "libre"}
            className={modo === "libre" ? "activa" : ""}
            onClick={() => setModo("libre")}
            disabled={enCurso}
          >
            Grabar libre (alineación automática)
          </button>
        </div>
        <p className="suave pequeno" style={{ margin: 0 }}>
          {modo === "sincronizado"
            ? "Suena la referencia y cantas encima; la app graba con el mismo reloj y compensa la latencia."
            : "Cantas a tu ritmo, sin música. Al parar, tu interpretación se alinea con la referencia (DTW)."}
        </p>

        <details>
          <summary style={{ cursor: "pointer", fontWeight: 600 }}>Opciones</summary>
          <div className="pila" style={{ marginTop: 10, gap: 12 }}>
            <div className="fila" style={{ alignItems: "flex-end" }}>
              <label className="campo">
                <span>Fragmento desde (s)</span>
                <input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step={0.5}
                  placeholder="0"
                  value={fragIni}
                  onChange={(e) => setFragIni(e.target.value)}
                  disabled={enCurso}
                />
              </label>
              <label className="campo">
                <span>hasta (s)</span>
                <input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step={0.5}
                  placeholder={duracion.toFixed(1)}
                  value={fragFin}
                  onChange={(e) => setFragFin(e.target.value)}
                  disabled={enCurso}
                />
              </label>
              {(fragIni || fragFin) && (
                <button
                  className="boton boton-pequeno"
                  onClick={() => {
                    setFragIni("");
                    setFragFin("");
                  }}
                  disabled={enCurso}
                >
                  Toda la canción
                </button>
              )}
            </div>
            <small className="suave">
              {fragmento
                ? `Practicarás de ${fmtTiempo(fragmento.inicio)} a ${fmtTiempo(fragmento.fin)} (${notasVista.length} notas).`
                : "Sin fragmento: se practica la canción entera."}
            </small>

            <label className="casilla">
              <input type="checkbox" checked={cuentaAtras} onChange={(e) => setCuentaAtras(e.target.checked)} disabled={enCurso} />
              <span>Cuenta atrás de {CLICS} clics antes de empezar</span>
            </label>

            {modo === "sincronizado" && (
              <div className="campo">
                <span>Acompañamiento (opcional)</span>
                {acomp ? (
                  <div className="fila">
                    <span className="chip" style={{ maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {acomp.nombre}
                    </span>
                    <button className="boton boton-pequeno" onClick={() => setAcomp(null)} disabled={enCurso}>
                      Quitar
                    </button>
                  </div>
                ) : (
                  <input
                    type="file"
                    accept="audio/*,.wav,.mp3,.ogg,.m4a,.flac"
                    disabled={enCurso}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      e.target.value = "";
                      if (f) cargarAcomp(f);
                    }}
                  />
                )}
                <small className="suave">
                  Por ejemplo <code>no_vocals.wav</code> de Demucs, para cantar sobre la base sin la voz original.
                  {ajustes.transposicion !== 0 &&
                    " La transposición solo se aplica a la melodía MIDI sintetizada, no a los audios."}
                </small>
              </div>
            )}
          </div>
        </details>

        <div className="fila">
          {enCurso ? (
            <>
              {fase === "grabando" && (
                <button className="boton boton-primario boton-grande" onClick={terminar}>
                  ■ Parar y evaluar
                </button>
              )}
              <button className="boton boton-grande" onClick={cancelar}>
                Cancelar
              </button>
            </>
          ) : (
            <>
              <button className="boton boton-primario boton-grande" onClick={empezar} disabled={fase === "analizando"}>
                ● {modo === "sincronizado" ? "Empezar a cantar" : "Empezar a grabar"}
              </button>
              {escucha.reproduciendo ? (
                <button className="boton" onClick={escucha.parar}>
                  ■ Parar
                </button>
              ) : (
                <button
                  className="boton"
                  disabled={fase === "analizando"}
                  onClick={() =>
                    escucha.iniciar({ audio: audio ?? undefined, notas: referencia.notas }, fragmento?.inicio ?? 0, {
                      hasta: fragmento?.fin,
                      la4: ajustes.la4,
                      transponer: ajustes.transposicion,
                    })
                  }
                >
                  ▶ Escuchar referencia
                </button>
              )}
            </>
          )}
        </div>

        {fase === "preparando" && <p className="suave" style={{ margin: 0 }}>Abriendo el micrófono…</p>}
        {fase === "analizando" && (
          <p className="suave" style={{ margin: 0 }} aria-live="polite">
            Analizando tu interpretación…
          </p>
        )}
        {(error || mic.error) && <div className="aviso aviso-error">{error ?? mic.error}</div>}
      </section>

      <section className="tarjeta pila">
        {cuenta > 0 && (
          <div className="cuenta-atras" aria-live="assertive">
            {cuenta}
          </div>
        )}
        {fase === "grabando" && (
          <div className="en-vivo">
            {modo === "sincronizado" && (
              <div className="metrica">
                <span className="etiqueta">Esperada</span>
                <div className="valor">{esperada ? nombreNota(esperada.midi + ajustes.transposicion, cfg) : "—"}</div>
              </div>
            )}
            <div className="metrica">
              <span className="etiqueta">Estás cantando</span>
              <div className="valor">{cantadaMidi != null ? fmtNotaConCents(cantadaMidi, cfg) : "—"}</div>
            </div>
            {modo === "sincronizado" && (
              <div className="metrica">
                <span className="etiqueta">Diferencia</span>
                <div className={`valor ${claseDif}`}>{difCents != null ? fmtCents(difCents) : "—"}</div>
                {octava !== 0 && <div className="detalle">octava corregida ({octava > 0 ? "+" : ""}{octava})</div>}
              </div>
            )}
            <div className="metrica">
              <span className="etiqueta">Tiempo</span>
              <div className="valor">{fmtTiempo(Math.max(0, tiempo))}</div>
            </div>
          </div>
        )}
        <PianoRoll
          notas={fase === "grabando" ? referencia.notas : notasVista}
          contornoRef={referencia.contorno}
          contornoUsuario={fase === "grabando" ? vivo : undefined}
          tiempoActual={fase === "grabando" ? tiempo : (escucha.tiempo ?? undefined)}
          ajustes={ajustes}
          tolerancia={modo === "sincronizado" ? tol : undefined}
          desplazarUsuario={desplazar}
          alto={300}
        />
      </section>
    </div>
  );
}
