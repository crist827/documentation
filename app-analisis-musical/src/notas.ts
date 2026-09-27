// Conversión entre Hz, notas MIDI y nombres de nota.

export const NOMBRES = ["Do", "Do#", "Re", "Re#", "Mi", "Fa", "Fa#", "Sol", "Sol#", "La", "La#", "Si"];

export interface ConfigNotas {
  /** Frecuencia del La central (normalmente 440). */
  la4: number;
  /** "cientifica": Do central = Do4. "hispana": Do central = Do3. */
  convencion: "cientifica" | "hispana";
}

export const CONFIG_DEFECTO: ConfigNotas = { la4: 440, convencion: "cientifica" };

export function hzAMidi(hz: number, la4 = 440): number {
  return 69 + 12 * Math.log2(hz / la4);
}

export function midiAHz(midi: number, la4 = 440): number {
  return la4 * Math.pow(2, (midi - 69) / 12);
}

/** Diferencia en cents de `a` respecto a `b` (ambas en MIDI). */
export function centsEntre(a: number, b: number): number {
  return (a - b) * 100;
}

export function nombreNota(midi: number, cfg: ConfigNotas = CONFIG_DEFECTO): string {
  const n = Math.round(midi);
  const octava = Math.floor(n / 12) - (cfg.convencion === "cientifica" ? 1 : 2);
  return `${NOMBRES[((n % 12) + 12) % 12]}${octava}`;
}

export interface InfoNota {
  nombre: string;
  midi: number;
  /** -50..+50 respecto a la nota más cercana. */
  cents: number;
  hz: number;
}

export function hzANota(hz: number, cfg: ConfigNotas = CONFIG_DEFECTO): InfoNota {
  const m = hzAMidi(hz, cfg.la4);
  const n = Math.round(m);
  return { nombre: nombreNota(n, cfg), midi: n, cents: Math.round((m - n) * 100), hz };
}

export function mediana(valores: number[]): number {
  if (valores.length === 0) return NaN;
  const v = [...valores].sort((a, b) => a - b);
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}
