// Formateo de valores para la interfaz (funciones puras).
import { nombreNota, type ConfigNotas } from "../notas";

const MENOS = "−";

/** Número con signo explícito: "+12", "−8", "0". */
export function conSigno(v: number, decimales = 0): string {
  const r = Number(v.toFixed(decimales));
  if (r === 0) return (0).toFixed(decimales);
  return (r > 0 ? "+" : MENOS) + Math.abs(r).toFixed(decimales);
}

export function fmtCents(c: number): string {
  return Number.isFinite(c) ? `${conSigno(c)} c` : "—";
}

export function fmtHz(hz: number, decimales = 1): string {
  return Number.isFinite(hz) ? `${hz.toFixed(decimales)} Hz` : "—";
}

export function fmtMs(ms: number): string {
  return Number.isFinite(ms) ? `${conSigno(ms)} ms` : "—";
}

/** Tiempo en "m:ss.d" (p. ej. 1:05.3). */
export function fmtTiempo(seg: number): string {
  if (!Number.isFinite(seg)) return "—";
  const neg = seg < 0;
  const s = Math.abs(seg);
  let m = Math.floor(s / 60);
  let r = Math.round((s - m * 60) * 10) / 10;
  if (r >= 60) {
    m += 1;
    r = 0;
  }
  const txt = `${m}:${r < 10 ? "0" : ""}${r.toFixed(1)}`;
  return neg ? MENOS + txt : txt;
}

/** Nombre de nota con los cents respecto a la nota más cercana: "Re#4 +30 c". */
export function fmtNotaConCents(midi: number, cfg: ConfigNotas): string {
  if (!Number.isFinite(midi)) return "—";
  const cents = Math.round((midi - Math.round(midi)) * 100);
  return cents === 0 ? nombreNota(midi, cfg) : `${nombreNota(midi, cfg)} ${fmtCents(cents)}`;
}

export function fmtPct(v: number): string {
  return Number.isFinite(v) ? `${Math.round(v)} %` : "—";
}

export function fmtFecha(ms: number): string {
  return new Date(ms).toLocaleString("es", { dateStyle: "short", timeStyle: "short" });
}

/** Sesgo en palabras: "alto", "bajo" o "centrado" (umbral ±15 c). */
export function describirSesgo(c: number): string {
  if (!Number.isFinite(c)) return "";
  if (c > 15) return "tiendes a alto";
  if (c < -15) return "tiendes a bajo";
  return "centrado";
}
