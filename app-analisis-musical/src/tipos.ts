// Contratos compartidos entre módulos. Todos los tiempos están en SEGUNDOS
// y todas las alturas en número de nota MIDI (con decimales = cents / 100).

/** Una nota discreta (de la referencia o de la voz segmentada). */
export interface Nota {
  inicio: number;
  fin: number;
  /** Nota MIDI con decimales (60.25 = Do4 +25 cents). */
  midi: number;
  hz: number;
}

/** Un frame del contorno de pitch. `midi` es null cuando no hay voz (silencio/ruido). */
export interface PuntoPitch {
  t: number;
  midi: number | null;
  /** Claridad/confianza 0..1 del detector. */
  claridad: number;
}

export type Contorno = PuntoPitch[];

export type TipoReferencia = "midi" | "acapella" | "cancion";

/** Una canción/referencia ya analizada. */
export interface Referencia {
  id: string;
  nombre: string;
  tipo: TipoReferencia;
  duracion: number;
  notas: Nota[];
  /** Contorno continuo (solo en audios; los MIDI no lo tienen). */
  contorno?: Contorno;
}

export type Nivel = "principiante" | "intermedio" | "avanzado";

export interface Tolerancia {
  /** |desvío| <= afinado → "afinada". */
  afinado: number;
  /** |desvío| <= aceptable → "aceptable"; por encima → "desafinada". */
  aceptable: number;
}

export const TOLERANCIAS: Record<Nivel, Tolerancia> = {
  principiante: { afinado: 50, aceptable: 80 },
  intermedio: { afinado: 25, aceptable: 50 },
  avanzado: { afinado: 15, aceptable: 30 },
};

export interface OpcionesComparacion {
  nivel: Nivel;
  /** Descontar automáticamente la diferencia de octava dominante. */
  corregirOctava: boolean;
  /** Semitonos que el usuario canta desplazado a propósito (+2 = un tono más agudo). */
  transposicion: number;
  /** Latencia conocida en ms; si es undefined se estima automáticamente. */
  latenciaMs?: number;
  /** "sincronizado" = karaoke (solo latencia); "libre" = alineación DTW. */
  modo: "sincronizado" | "libre";
}

export type EstadoNota = "afinada" | "aceptable" | "desafinada" | "omitida";

export interface ResultadoNota {
  ref: Nota;
  /** Mediana del pitch cantado dentro de la nota (ya corregido de octava/transposición). */
  cantada?: { midi: number; hz: number };
  /** Con signo: + = alto (sostenido), − = bajo (calado). */
  desvioCents: number;
  desvioHz: number;
  /** % (0..100) de frames con voz dentro de la tolerancia "afinado". */
  pctFramesAfinados: number;
  /** + = entraste tarde. */
  retrasoEntradaMs: number;
  /** + = soltaste tarde, − = cortaste antes. */
  diferenciaFinMs: number;
  /** Desviación típica (cents) en el 60 % central, sin vibrato. */
  estabilidadCents: number;
  /** Pendiente del pitch en la parte sostenida (cents/s). */
  derivaCentsPorSeg: number;
  /** Tiempo (ms) desde la entrada hasta quedar dentro de ±30 c. */
  ataqueMs: number;
  /** Entró desde abajo (> 50 c por debajo) antes de afinar. */
  scoop: boolean;
  vibrato?: { hz: number; amplitudCents: number };
  estado: EstadoNota;
}

export interface Metricas {
  errorMedioCents: number;
  sesgoCents: number;
  pctNotasAfinadas: number;
  pctNotasOmitidas: number;
  estabilidadCents: number;
  derivaCentsPorSeg: number;
  pctScoop: number;
  ataqueMedioMs: number;
  retrasoEntradaMedioMs: number;
  dispersionEntradaMs: number;
  duracionRelativa: number;
  errorSaltosCents: number;
  errorGradosConjuntosCents: number;
  errorPorRegistro: { grave: number; medio: number; agudo: number };
  vibratoMedio?: { hz: number; amplitudCents: number };
}

export interface Consejo {
  id: string;
  /** Mayor = más importante. Se muestran los 3 primeros. */
  gravedad: number;
  titulo: string;
  mensaje: string;
  ejercicio: string;
}

export interface Informe {
  fecha: number;
  referenciaId: string;
  referenciaNombre: string;
  opciones: OpcionesComparacion;
  latenciaMs: number;
  /** Octavas descontadas (−1 = el usuario cantó una octava por debajo). */
  desplazamientoOctava: number;
  resultados: ResultadoNota[];
  metricas: Metricas;
  consejos: Consejo[];
  puntuacion: number;
  desglose: { afinacion: number; estabilidad: number; ritmo: number; ataques: number };
  /** Contorno del usuario ya alineado al tiempo de la referencia (para la gráfica). */
  contornoUsuario: Contorno;
}
