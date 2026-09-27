// Estado global de la app (contexto de React).
import { createContext, useContext } from "react";
import type { Ajustes } from "../ajustes";
import type { PistaInfo } from "../db";
import type { Informe, Referencia } from "../tipos";

export type Pestana = "afinador" | "cancion" | "practicar" | "informe" | "progreso";

/** Datos del archivo del que salió la referencia actual (para reanalizar). */
export interface OrigenReferencia {
  archivo: File | null;
  pistas?: PistaInfo[];
  pista?: number;
}

export interface EstadoApp {
  ajustes: Ajustes;
  cambiarAjustes(parcial: Partial<Ajustes>): void;
  referencia: Referencia | null;
  audio: AudioBuffer | null;
  origen: OrigenReferencia | null;
  fijarReferencia(ref: Referencia | null, audio?: AudioBuffer | null, origen?: OrigenReferencia | null): void;
  informe: Informe | null;
  fijarInforme(inf: Informe | null): void;
  pestana: Pestana;
  irA(p: Pestana): void;
  abrirAjustes(): void;
}

export const ContextoApp = createContext<EstadoApp | null>(null);

export function useApp(): EstadoApp {
  const c = useContext(ContextoApp);
  if (!c) throw new Error("useApp fuera de <ContextoApp.Provider>");
  return c;
}
