// Lectura de archivos MIDI: elige la pista de la melodía y la reduce a una sola línea.
import { Midi } from "@tonejs/midi";
import type { Nota } from "../tipos";
import { midiAHz } from "../notas";

export interface InfoPista {
  indice: number;
  nombre: string;
  numNotas: number;
  /** 0..1: fracción del tiempo sonoro con más de una nota a la vez. */
  polifonia: number;
  /** Altura MIDI media de las notas. */
  alturaMedia: number;
}

interface NotaCruda {
  inicio: number;
  fin: number;
  midi: number;
}

const NOMBRES_MELODIA = /voice|vocal|voz|melod|lead|canto|sing/i;
/** Fragmentos del skyline más cortos que esto se descartan (s). */
const MIN_FRAGMENTO = 0.03;
/** Una nota que "reaparece" tras quedar tapada por otra más aguda solo cuenta si dura al menos esto (s). */
const MIN_REANUDACION = 0.1;

/** Fracción del tiempo sonoro con más de una nota simultánea. */
function calcularPolifonia(notas: NotaCruda[]): number {
  const eventos: [number, number][] = [];
  for (const n of notas) {
    if (n.fin <= n.inicio) continue;
    eventos.push([n.inicio, 1], [n.fin, -1]);
  }
  // Los finales antes que los inicios en el mismo instante (notas contiguas no se solapan).
  eventos.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let activas = 0;
  let prev = 0;
  let sonoro = 0;
  let poli = 0;
  for (const [t, d] of eventos) {
    const dt = t - prev;
    if (activas >= 1) sonoro += dt;
    if (activas > 1) poli += dt;
    activas += d;
    prev = t;
  }
  return sonoro > 0 ? poli / sonoro : 0;
}

/** Skyline: en cada instante se queda con la nota más aguda que suena. Sin solapamientos. */
function skyline(notas: NotaCruda[]): NotaCruda[] {
  const validas = notas.filter((n) => n.fin > n.inicio);
  if (validas.length === 0) return [];
  const cortes = Array.from(new Set(validas.flatMap((n) => [n.inicio, n.fin]))).sort((a, b) => a - b);
  const porInicio = validas.map((n, i) => ({ ...n, id: i })).sort((a, b) => a.inicio - b.inicio);

  // Tramos elementales [cortes[k], cortes[k+1]) con la nota más aguda activa.
  const tramos: { inicio: number; fin: number; midi: number; id: number }[] = [];
  let activas: typeof porInicio = [];
  let sig = 0;
  for (let k = 0; k < cortes.length - 1; k++) {
    const a = cortes[k];
    const b = cortes[k + 1];
    while (sig < porInicio.length && porInicio[sig].inicio <= a) activas.push(porInicio[sig++]);
    activas = activas.filter((n) => n.fin > a);
    if (activas.length === 0) continue;
    // La más aguda; a igual altura, la que empezó más tarde (re-ataque).
    let top = activas[0];
    for (const n of activas) {
      if (n.midi > top.midi || (n.midi === top.midi && n.inicio > top.inicio)) top = n;
    }
    const ult = tramos[tramos.length - 1];
    if (ult && ult.id === top.id && Math.abs(ult.fin - a) < 1e-9) ult.fin = b;
    else tramos.push({ inicio: a, fin: b, midi: top.midi, id: top.id });
  }

  // Descarta fragmentos mínimos y reanudaciones cortas de notas ya tapadas.
  const vistas = new Set<number>();
  const res: NotaCruda[] = [];
  for (const t of tramos) {
    const dur = t.fin - t.inicio;
    const reanudacion = vistas.has(t.id);
    vistas.add(t.id);
    if (dur < MIN_FRAGMENTO || (reanudacion && dur < MIN_REANUDACION)) continue;
    res.push({ inicio: t.inicio, fin: t.fin, midi: t.midi });
  }
  return res;
}

function esPercusion(pista: Midi["tracks"][number]): boolean {
  return pista.channel === 9 || pista.instrument.percussion;
}

/** Elige la pista de la melodía entre las candidatas (con notas y sin percusión). */
function elegirPista(pistas: InfoPista[]): number {
  const porNombre = pistas.filter((p) => NOMBRES_MELODIA.test(p.nombre));
  const candidatas = porNombre.length > 0 ? porNombre : pistas;
  // Menor polifonía y mayor altura: una pista totalmente polifónica "pierde" 24 semitonos.
  // Las pistas con muy pocas notas se penalizan (efectos, notas sueltas).
  const puntuar = (p: InfoPista) => p.alturaMedia - 24 * p.polifonia - (p.numNotas < 8 ? 24 : 0);
  let mejor = candidatas[0];
  for (const p of candidatas) if (puntuar(p) > puntuar(mejor)) mejor = p;
  return mejor.indice;
}

export function leerMidi(
  datos: ArrayBuffer,
  pista?: number,
): { notas: Nota[]; duracion: number; pistas: InfoPista[]; pistaElegida: number } {
  let midi: Midi;
  try {
    midi = new Midi(datos);
  } catch {
    throw new Error("El archivo MIDI está dañado o no es un MIDI válido.");
  }

  const crudas = midi.tracks.map((t) =>
    t.notes.map((n) => ({ inicio: n.time, fin: n.time + n.duration, midi: n.midi })),
  );
  const pistas: InfoPista[] = [];
  midi.tracks.forEach((t, i) => {
    if (t.notes.length === 0 || esPercusion(t)) return;
    const notas = crudas[i];
    pistas.push({
      indice: i,
      nombre: t.name || t.instrument.name || `Pista ${i + 1}`,
      numNotas: notas.length,
      polifonia: calcularPolifonia(notas),
      alturaMedia: notas.reduce((s, n) => s + n.midi, 0) / notas.length,
    });
  });
  if (pistas.length === 0) throw new Error("El MIDI no contiene notas melódicas.");

  let elegida: number;
  if (pista !== undefined) {
    if (!pistas.some((p) => p.indice === pista)) throw new Error(`La pista ${pista} no existe o no tiene notas.`);
    elegida = pista;
  } else {
    elegida = elegirPista(pistas);
  }

  const notas: Nota[] = skyline(crudas[elegida]).map((n) => ({
    inicio: n.inicio,
    fin: n.fin,
    midi: n.midi,
    hz: midiAHz(n.midi),
  }));
  const duracion = Math.max(midi.duration, notas.length ? notas[notas.length - 1].fin : 0);
  return { notas, duracion, pistas, pistaElegida: elegida };
}
