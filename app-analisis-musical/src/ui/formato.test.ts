import { describe, expect, it } from "vitest";
import { conSigno, describirSesgo, fmtCents, fmtNotaConCents, fmtTiempo } from "./formato";

const cfg = { la4: 440, convencion: "cientifica" as const };

describe("formato", () => {
  it("conSigno usa + y el signo menos tipográfico", () => {
    expect(conSigno(12.4)).toBe("+12");
    expect(conSigno(-8)).toBe("−8");
    expect(conSigno(0.2)).toBe("0");
    expect(conSigno(-0.04, 1)).toBe("0.0");
  });

  it("fmtCents maneja valores no finitos", () => {
    expect(fmtCents(30)).toBe("+30 c");
    expect(fmtCents(NaN)).toBe("—");
  });

  it("fmtTiempo", () => {
    expect(fmtTiempo(0)).toBe("0:00.0");
    expect(fmtTiempo(65.34)).toBe("1:05.3");
    expect(fmtTiempo(59.97)).toBe("1:00.0");
  });

  it("fmtNotaConCents", () => {
    expect(fmtNotaConCents(64, cfg)).toBe("Mi4");
    expect(fmtNotaConCents(63.3, cfg)).toBe("Re#4 +30 c");
    expect(fmtNotaConCents(63.7, { ...cfg, convencion: "hispana" })).toBe("Mi3 −30 c");
  });

  it("describirSesgo", () => {
    expect(describirSesgo(20)).toBe("tiendes a alto");
    expect(describirSesgo(-20)).toBe("tiendes a bajo");
    expect(describirSesgo(5)).toBe("centrado");
  });
});
