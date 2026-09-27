// Raíz de la app: cabecera, pestañas y estado global.
import { useCallback, useMemo, useState } from "react";
import { cargarAjustes, guardarAjustes, type Ajustes } from "./ajustes";
import type { Informe, Referencia } from "./tipos";
import { ContextoApp, type EstadoApp, type OrigenReferencia, type Pestana } from "./ui/estadoApp";
import Afinador from "./ui/Afinador";
import Cancion from "./ui/Cancion";
import Practicar from "./ui/Practicar";
import InformeVista from "./ui/InformeVista";
import Progreso from "./ui/Progreso";
import AjustesPanel from "./ui/AjustesPanel";

const PESTANAS: { id: Pestana; texto: string }[] = [
  { id: "afinador", texto: "Afinador" },
  { id: "cancion", texto: "Canción" },
  { id: "practicar", texto: "Practicar" },
  { id: "informe", texto: "Informe" },
  { id: "progreso", texto: "Progreso" },
];

export default function App() {
  const [ajustes, setAjustes] = useState<Ajustes>(cargarAjustes);
  const [pestana, setPestana] = useState<Pestana>("afinador");
  const [referencia, setReferencia] = useState<Referencia | null>(null);
  const [audio, setAudio] = useState<AudioBuffer | null>(null);
  const [origen, setOrigen] = useState<OrigenReferencia | null>(null);
  const [informe, setInforme] = useState<Informe | null>(null);
  const [verAjustes, setVerAjustes] = useState(false);

  const cambiarAjustes = useCallback((parcial: Partial<Ajustes>) => {
    setAjustes((prev) => {
      const nuevo = { ...prev, ...parcial };
      guardarAjustes(nuevo);
      return nuevo;
    });
  }, []);

  const fijarReferencia = useCallback(
    (ref: Referencia | null, aud: AudioBuffer | null = null, org: OrigenReferencia | null = null) => {
      setReferencia(ref);
      setAudio(aud);
      setOrigen(org);
    },
    [],
  );

  const irA = useCallback((p: Pestana) => {
    setPestana(p);
    window.scrollTo({ top: 0 });
  }, []);

  const estado = useMemo<EstadoApp>(
    () => ({
      ajustes,
      cambiarAjustes,
      referencia,
      audio,
      origen,
      fijarReferencia,
      informe,
      fijarInforme: setInforme,
      pestana,
      irA,
      abrirAjustes: () => setVerAjustes(true),
    }),
    [ajustes, cambiarAjustes, referencia, audio, origen, fijarReferencia, informe, pestana, irA],
  );

  return (
    <ContextoApp.Provider value={estado}>
      <div className="app">
        <header className="cabecera">
          <div className="cabecera-fila">
            <h1 className="logo">
              <span aria-hidden="true">♪ </span>Entrenador Vocal
            </h1>
            <button className="boton boton-pequeno" onClick={() => setVerAjustes(true)} aria-haspopup="dialog">
              <span aria-hidden="true">⚙</span> Ajustes
            </button>
          </div>
          <nav className="pestanas" role="tablist" aria-label="Secciones">
            {PESTANAS.map((p) => (
              <button
                key={p.id}
                role="tab"
                aria-selected={pestana === p.id}
                className={`pestana${pestana === p.id ? " activa" : ""}`}
                onClick={() => irA(p.id)}
              >
                {p.texto}
                {p.id === "informe" && informe ? " •" : ""}
              </button>
            ))}
          </nav>
        </header>

        <main className="principal" role="tabpanel">
          {pestana === "afinador" && <Afinador />}
          {pestana === "cancion" && <Cancion />}
          {pestana === "practicar" && <Practicar />}
          {pestana === "informe" && <InformeVista />}
          {pestana === "progreso" && <Progreso />}
        </main>

        {verAjustes && <AjustesPanel onCerrar={() => setVerAjustes(false)} />}
      </div>
    </ContextoApp.Provider>
  );
}
