import { describe, expect, it } from "vitest";
import { Midi } from "@tonejs/midi";
import { leerMidi } from "./midi";
import { midiAHz } from "../notas";

function buffer(m: Midi): ArrayBuffer {
  const a = m.toArray();
  return a.buffer.slice(a.byteOffset, a.byteOffset + a.byteLength) as ArrayBuffer;
}

/** Piano con acordes (pista 0) + melodía "Voice" (pista 1) + batería. */
function crearMidi(nombreMelodia = "Voice"): Midi {
  const m = new Midi();
  m.header.setTempo(120);
  const piano = m.addTrack();
  piano.name = "Piano";
  for (let i = 0; i < 4; i++) {
    for (const nota of [72, 76, 79]) piano.addNote({ midi: nota, time: i, duration: 1 });
  }
  const voz = m.addTrack();
  voz.name = nombreMelodia;
  const mel = [60, 62, 64, 65, 67, 65, 64, 62];
  mel.forEach((nota, i) => voz.addNote({ midi: nota, time: i * 0.5, duration: 0.45 }));
  const bat = m.addTrack();
  bat.channel = 9;
  for (let i = 0; i < 8; i++) bat.addNote({ midi: 90, time: i * 0.5, duration: 0.1 });
  return m;
}

describe("leerMidi", () => {
  it("elige la pista 'Voice' aunque el piano sea más agudo", () => {
    const r = leerMidi(buffer(crearMidi()));
    expect(r.pistaElegida).toBe(1);
    expect(r.pistas.map((p) => p.indice)).toEqual([0, 1]); // la batería no aparece
    const piano = r.pistas.find((p) => p.indice === 0)!;
    expect(piano.polifonia).toBeCloseTo(1, 2);
    expect(r.pistas.find((p) => p.indice === 1)!.polifonia).toBe(0);
    expect(r.notas.map((n) => n.midi)).toEqual([60, 62, 64, 65, 67, 65, 64, 62]);
    r.notas.forEach((n, i) => {
      expect(n.inicio).toBeCloseTo(i * 0.5, 2);
      expect(n.fin - n.inicio).toBeCloseTo(0.45, 2);
      expect(n.hz).toBeCloseTo(midiAHz(n.midi), 6);
    });
    expect(r.duracion).toBeCloseTo(4, 2);
  });

  it("sin nombres reconocibles elige la pista monofónica", () => {
    const r = leerMidi(buffer(crearMidi("Pista 2")));
    expect(r.pistaElegida).toBe(1);
  });

  it("pista explícita: reduce los acordes a la nota más aguda (skyline)", () => {
    const r = leerMidi(buffer(crearMidi()), 0);
    expect(r.pistaElegida).toBe(0);
    expect(r.notas).toHaveLength(4);
    for (const n of r.notas) expect(n.midi).toBe(79);
    for (let i = 1; i < r.notas.length; i++) expect(r.notas[i].inicio).toBeGreaterThanOrEqual(r.notas[i - 1].fin - 1e-9);
  });

  it("recorta solapamientos de una melodía con legato", () => {
    const m = new Midi();
    const t = m.addTrack();
    t.name = "Lead";
    t.addNote({ midi: 67, time: 0, duration: 0.6 });
    t.addNote({ midi: 64, time: 0.5, duration: 0.5 }); // solapa 0.1 s con la anterior
    t.addNote({ midi: 60, time: 1, duration: 0.5 });
    const r = leerMidi(buffer(m));
    expect(r.notas.map((n) => n.midi)).toEqual([67, 64, 60]);
    for (let i = 1; i < r.notas.length; i++) expect(r.notas[i].inicio).toBeGreaterThanOrEqual(r.notas[i - 1].fin - 1e-9);
  });

  it("pista inexistente o MIDI inválido → error en español", () => {
    expect(() => leerMidi(buffer(crearMidi()), 2)).toThrow(/pista/);
    expect(() => leerMidi(new Uint8Array([1, 2, 3, 4]).buffer)).toThrow(/MIDI/);
  });
});
