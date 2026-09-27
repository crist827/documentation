// Panel lateral de ajustes.
import { useEffect, useRef, useState } from "react";
import { AJUSTES_DEFECTO } from "../ajustes";
import { latenciaSalida, obtenerContexto } from "../audio/contexto";
import { TOLERANCIAS, type Nivel } from "../tipos";
import { nombreNota } from "../notas";
import { useApp } from "./estadoApp";
import { conSigno } from "./formato";

const NIVELES: { id: Nivel; texto: string }[] = [
  { id: "principiante", texto: "Principiante" },
  { id: "intermedio", texto: "Intermedio" },
  { id: "avanzado", texto: "Avanzado" },
];

export default function AjustesPanel({ onCerrar }: { onCerrar(): void }) {
  const { ajustes, cambiarAjustes } = useApp();
  const panel = useRef<HTMLDivElement>(null);
  const [latTexto, setLatTexto] = useState(ajustes.latenciaManualMs == null ? "" : String(ajustes.latenciaManualMs));
  const [latNavegador, setLatNavegador] = useState<number | null>(null);

  useEffect(() => {
    panel.current?.focus();
    const tecla = (e: KeyboardEvent) => e.key === "Escape" && onCerrar();
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, [onCerrar]);

  // Latencia de salida que expone el navegador (se abre tras el clic en Ajustes)
  useEffect(() => {
    obtenerContexto()
      .then((ctx) => setLatNavegador(Math.round(latenciaSalida(ctx) * 1000)))
      .catch(() => setLatNavegador(null));
  }, []);

  const tol = TOLERANCIAS[ajustes.nivel];
  const cfg = { la4: ajustes.la4, convencion: ajustes.convencion };

  const fijarLatencia = (txt: string) => {
    setLatTexto(txt);
    if (txt.trim() === "") return cambiarAjustes({ latenciaManualMs: null });
    const v = Number(txt);
    if (Number.isFinite(v)) cambiarAjustes({ latenciaManualMs: Math.max(-1000, Math.min(1000, Math.round(v))) });
  };

  return (
    <div className="velo" onClick={onCerrar}>
      <div
        className="panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="titulo-ajustes"
        tabIndex={-1}
        ref={panel}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="fila fila-entre">
          <h2 id="titulo-ajustes" style={{ margin: 0 }}>
            Ajustes
          </h2>
          <button className="boton boton-pequeno" onClick={onCerrar}>
            Cerrar
          </button>
        </div>

        <div className="campo">
          <span>Nivel de exigencia</span>
          <div className="segmentado" role="radiogroup" aria-label="Nivel">
            {NIVELES.map((n) => (
              <button
                key={n.id}
                role="radio"
                aria-checked={ajustes.nivel === n.id}
                className={ajustes.nivel === n.id ? "activa" : ""}
                onClick={() => cambiarAjustes({ nivel: n.id })}
              >
                {n.texto}
              </button>
            ))}
          </div>
          <small className="suave">
            Afinada ≤ ±{tol.afinado} c · aceptable ≤ ±{tol.aceptable} c · desafinada &gt; {tol.aceptable} c
          </small>
        </div>

        <label className="casilla">
          <input
            type="checkbox"
            checked={ajustes.corregirOctava}
            onChange={(e) => cambiarAjustes({ corregirOctava: e.target.checked })}
          />
          <span>
            Corregir la octava automáticamente
            <br />
            <small className="suave">Cantar una octava por debajo o por encima no cuenta como error.</small>
          </span>
        </label>

        <div className="campo">
          <span>Transposición: {conSigno(ajustes.transposicion)} semitonos</span>
          <input
            type="range"
            min={-12}
            max={12}
            step={1}
            value={ajustes.transposicion}
            onChange={(e) => cambiarAjustes({ transposicion: Number(e.target.value) })}
          />
          <small className="suave">Si cantas la canción en otra tonalidad (+2 = un tono más agudo).</small>
        </div>

        <div className="campo">
          <span>Nombres de las octavas</span>
          <div className="segmentado">
            <button
              className={ajustes.convencion === "cientifica" ? "activa" : ""}
              onClick={() => cambiarAjustes({ convencion: "cientifica" })}
            >
              Científica (Do central = Do4)
            </button>
            <button
              className={ajustes.convencion === "hispana" ? "activa" : ""}
              onClick={() => cambiarAjustes({ convencion: "hispana" })}
            >
              Hispana (Do central = Do3)
            </button>
          </div>
          <small className="suave">El Do central se mostrará como {nombreNota(60, cfg)}.</small>
        </div>

        <div className="campo">
          <span>La de referencia: {ajustes.la4} Hz</span>
          <input
            type="range"
            min={415}
            max={466}
            step={1}
            value={ajustes.la4}
            onChange={(e) => cambiarAjustes({ la4: Number(e.target.value) })}
          />
          <div className="fila">
            {[440, 442, 432, 415].map((v) => (
              <button key={v} className="boton boton-pequeno" onClick={() => cambiarAjustes({ la4: v })}>
                {v}
              </button>
            ))}
          </div>
        </div>

        <div className="campo">
          <span>Latencia manual (ms)</span>
          <input
            type="number"
            inputMode="numeric"
            placeholder="Automática"
            style={{ width: "10em" }}
            value={latTexto}
            onChange={(e) => fijarLatencia(e.target.value)}
          />
          <small className="suave">
            Déjalo vacío para estimarla automáticamente en cada práctica.
            {latNavegador != null && latNavegador > 0 && ` El navegador informa de ${latNavegador} ms de latencia de salida.`}
          </small>
        </div>

        <button
          className="boton"
          onClick={() => {
            cambiarAjustes(AJUSTES_DEFECTO);
            setLatTexto("");
          }}
        >
          Restablecer valores por defecto
        </button>
      </div>
    </div>
  );
}
