import { describe, expect, it } from "vitest";
import { tipoDeArchivo } from "./api";

describe("tipoDeArchivo", () => {
  it("reconoce extensiones", () => {
    expect(tipoDeArchivo("cancion.MID")).toBe("midi");
    expect(tipoDeArchivo("a.midi")).toBe("midi");
    for (const e of ["mp3", "wav", "ogg", "m4a", "flac", "webm", "aac"]) expect(tipoDeArchivo(`x.y.${e}`)).toBe("audio");
    expect(tipoDeArchivo("partitura.musicxml")).toBeNull();
    expect(tipoDeArchivo("sinextension")).toBeNull();
  });
});
