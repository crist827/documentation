// Hook para reproducir la referencia y seguir el tiempo con requestAnimationFrame.
import { useCallback, useEffect, useRef, useState } from "react";
import { obtenerContexto } from "../audio/contexto";
import {
  reproducir,
  type FuenteReproduccion,
  type OpcionesReproduccion,
  type Reproduccion,
} from "../referencia/reproductor";

export interface EstadoReproduccion {
  reproduciendo: boolean;
  /** Tiempo actual en la referencia (s), o null si no se reproduce. */
  tiempo: number | null;
  iniciar(fuente: FuenteReproduccion, desde?: number, opciones?: OpcionesReproduccion): Promise<void>;
  parar(): void;
}

export function useReproduccion(): EstadoReproduccion {
  const [tiempo, setTiempo] = useState<number | null>(null);
  const actual = useRef<{ rep: Reproduccion; raf: number } | null>(null);

  const parar = useCallback(() => {
    const a = actual.current;
    actual.current = null;
    if (a) {
      cancelAnimationFrame(a.raf);
      a.rep.parar();
    }
    setTiempo(null);
  }, []);

  const iniciar = useCallback(
    async (fuente: FuenteReproduccion, desde = 0, opciones?: OpcionesReproduccion) => {
      parar();
      const ctx = await obtenerContexto();
      const cuando = ctx.currentTime + 0.1;
      const rep = reproducir(ctx, fuente, cuando, desde, opciones);
      const estado = { rep, raf: 0 };
      actual.current = estado;
      const paso = () => {
        if (actual.current !== estado) return;
        if (ctx.currentTime >= rep.fin + 0.1) return parar();
        setTiempo(desde + Math.max(0, ctx.currentTime - cuando));
        estado.raf = requestAnimationFrame(paso);
      };
      estado.raf = requestAnimationFrame(paso);
    },
    [parar],
  );

  useEffect(() => parar, [parar]);

  return { reproduciendo: tiempo !== null, tiempo, iniciar, parar };
}
