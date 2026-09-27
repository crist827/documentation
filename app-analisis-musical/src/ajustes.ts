// Ajustes del usuario, persistidos en localStorage.
import type { Nivel } from "./tipos";
import type { ConfigNotas } from "./notas";

export interface Ajustes {
  nivel: Nivel;
  corregirOctava: boolean;
  /** Semitonos (−12..+12). */
  transposicion: number;
  convencion: "cientifica" | "hispana";
  /** Frecuencia del La de referencia (415..466 Hz). */
  la4: number;
  /** null = latencia estimada automáticamente. */
  latenciaManualMs: number | null;
}

export const AJUSTES_DEFECTO: Ajustes = {
  nivel: "intermedio",
  corregirOctava: true,
  transposicion: 0,
  convencion: "cientifica",
  la4: 440,
  latenciaManualMs: null,
};

const CLAVE = "entrenador-vocal:ajustes";
const NIVELES: Nivel[] = ["principiante", "intermedio", "avanzado"];

function limitar(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

/** Valida y completa un objeto desconocido (p. ej. leído de localStorage). */
export function normalizarAjustes(bruto: unknown): Ajustes {
  const a = { ...AJUSTES_DEFECTO };
  if (!bruto || typeof bruto !== "object") return a;
  const o = bruto as Record<string, unknown>;
  if (NIVELES.includes(o.nivel as Nivel)) a.nivel = o.nivel as Nivel;
  if (typeof o.corregirOctava === "boolean") a.corregirOctava = o.corregirOctava;
  if (typeof o.transposicion === "number" && Number.isFinite(o.transposicion))
    a.transposicion = limitar(Math.round(o.transposicion), -12, 12);
  if (o.convencion === "cientifica" || o.convencion === "hispana") a.convencion = o.convencion;
  if (typeof o.la4 === "number" && Number.isFinite(o.la4)) a.la4 = limitar(o.la4, 415, 466);
  if (o.latenciaManualMs === null) a.latenciaManualMs = null;
  else if (typeof o.latenciaManualMs === "number" && Number.isFinite(o.latenciaManualMs))
    a.latenciaManualMs = limitar(Math.round(o.latenciaManualMs), -1000, 1000);
  return a;
}

export function cargarAjustes(): Ajustes {
  try {
    const txt = localStorage.getItem(CLAVE);
    return txt ? normalizarAjustes(JSON.parse(txt)) : { ...AJUSTES_DEFECTO };
  } catch {
    return { ...AJUSTES_DEFECTO };
  }
}

export function guardarAjustes(a: Ajustes): void {
  try {
    localStorage.setItem(CLAVE, JSON.stringify(a));
  } catch {
    // almacenamiento no disponible (modo privado, etc.): se ignora
  }
}

/** Configuración para `nombreNota` / `hzANota`. */
export function configNotas(a: Pick<Ajustes, "la4" | "convencion">): ConfigNotas {
  return { la4: a.la4, convencion: a.convencion };
}
