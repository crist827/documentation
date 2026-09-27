import { describe, expect, it } from "vitest";
import { hzANota, hzAMidi, midiAHz, nombreNota } from "./notas";

describe("notas", () => {
  it("convierte La4 = 440 Hz", () => {
    expect(hzAMidi(440)).toBeCloseTo(69);
    expect(hzANota(440)).toMatchObject({ nombre: "La4", midi: 69, cents: 0 });
  });

  it("nombra alteraciones y octavas", () => {
    expect(hzANota(155.56).nombre).toBe("Re#3");
    expect(nombreNota(60)).toBe("Do4");
    expect(nombreNota(60, { la4: 440, convencion: "hispana" })).toBe("Do3");
  });

  it("calcula cents y respeta el La de referencia", () => {
    expect(hzANota(midiAHz(69.3)).cents).toBe(30);
    expect(hzANota(442, { la4: 442, convencion: "cientifica" }).cents).toBe(0);
  });
});
