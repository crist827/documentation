// Hook de pitch en tiempo real: micrófono → bloques de audio → DetectorVoz.
// Preferente: AudioWorklet que manda bloques de ~10 ms con su instante exacto.
// Alternativa (navegadores sin AudioWorklet): AnalyserNode + setInterval(10 ms).

import { useCallback, useEffect, useRef, useState } from "react";
import type { Contorno, PuntoPitch } from "../tipos";
import { DetectorVoz, type LecturaPitch } from "./detector";
import { abrirMicrofono, type Microfono } from "./mic";

export interface EstadoMic {
  activo: boolean;
  error: string | null;
  /** Lectura más reciente (para la UI). */
  ultimo: LecturaPitch | null;
  /** Últimos 10 s, t en segundos de ctx.currentTime. */
  historial: Contorno;
  ctx: AudioContext | null;
  iniciar(): Promise<void>;
  detener(): void;
  /** Empieza a acumular el contorno; t de cada punto = ctx.currentTime - t0 (segundos). */
  iniciarGrabacion(t0: number): void;
  /** Devuelve el contorno grabado (PuntoPitch[] de ../tipos) y deja de grabar. */
  detenerGrabacion(): Contorno;
}

const TAMANO = 2048;
const SEGUNDOS_HISTORIAL = 10;
const SALTO_SEG = 0.01;
const MS_PUBLICAR = 33; // ~30 actualizaciones de estado por segundo

// El worklet acumula `salto` muestras y las envía junto al instante (reloj del
// contexto) justo después de la última muestra del bloque.
const CODIGO_WORKLET = `
class CapturaPitch extends AudioWorkletProcessor {
  constructor(o) {
    super();
    this.salto = o.processorOptions.salto;
    this.buf = new Float32Array(this.salto);
    this.n = 0;
  }
  process(inputs) {
    const c = inputs[0] && inputs[0][0];
    if (!c) return true;
    for (let i = 0; i < c.length; i++) {
      this.buf[this.n++] = c[i];
      if (this.n === this.salto) {
        this.port.postMessage({ datos: this.buf, tFin: currentTime + (i + 1) / sampleRate }, [this.buf.buffer]);
        this.buf = new Float32Array(this.salto);
        this.n = 0;
      }
    }
    return true;
  }
}
registerProcessor("captura-pitch", CapturaPitch);
`;

const modulosCargados = new WeakMap<AudioContext, Promise<void>>();

function cargarWorklet(ctx: AudioContext): Promise<void> {
  let p = modulosCargados.get(ctx);
  if (!p) {
    const url = URL.createObjectURL(new Blob([CODIGO_WORKLET], { type: "application/javascript" }));
    p = ctx.audioWorklet.addModule(url).finally(() => URL.revokeObjectURL(url));
    p.catch(() => modulosCargados.delete(ctx));
    modulosCargados.set(ctx, p);
  }
  return p;
}

interface Sesion {
  mic: Microfono;
  nodos: AudioNode[];
  intervalo?: ReturnType<typeof setInterval>;
}

export function useMicPitch(): EstadoMic {
  const [activo, setActivo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ultimo, setUltimo] = useState<LecturaPitch | null>(null);
  const [historial, setHistorial] = useState<Contorno>([]);
  const [ctx, setCtx] = useState<AudioContext | null>(null);

  const sesion = useRef<Sesion | null>(null);
  /** Se incrementa en cada iniciar/detener para descartar aperturas obsoletas. */
  const generacion = useRef(0);
  const hist = useRef<PuntoPitch[]>([]);
  const grab = useRef<{ t0: number; puntos: PuntoPitch[] } | null>(null);
  const ultimoRef = useRef<LecturaPitch | null>(null);
  const sucio = useRef(false);

  const registrar = useCallback((l: LecturaPitch, t: number) => {
    const p: PuntoPitch = { t, midi: l.midi, claridad: l.claridad };
    const h = hist.current;
    h.push(p);
    const corte = t - SEGUNDOS_HISTORIAL;
    let i = 0;
    while (i < h.length && h[i].t < corte) i++;
    if (i > 0) h.splice(0, i);
    const g = grab.current;
    if (g && t >= g.t0) g.puntos.push({ t: t - g.t0, midi: l.midi, claridad: l.claridad });
    ultimoRef.current = l;
    sucio.current = true;
  }, []);

  const liberar = useCallback(() => {
    const s = sesion.current;
    sesion.current = null;
    if (!s) return;
    if (s.intervalo) clearInterval(s.intervalo);
    for (const n of s.nodos) {
      if ("port" in n) (n as AudioWorkletNode).port.onmessage = null;
      try {
        n.disconnect();
      } catch {
        // ya desconectado
      }
    }
    s.mic.cerrar();
  }, []);

  const detener = useCallback(() => {
    generacion.current++;
    liberar();
    ultimoRef.current = null;
    sucio.current = false;
    setActivo(false);
    setUltimo(null);
  }, [liberar]);

  const iniciar = useCallback(async () => {
    if (sesion.current) return;
    const gen = ++generacion.current;
    setError(null);
    let mic: Microfono;
    try {
      mic = await abrirMicrofono();
    } catch (e) {
      if (gen === generacion.current) setError((e as Error).message);
      return;
    }
    if (gen !== generacion.current) {
      mic.cerrar();
      return;
    }

    const c = mic.ctx;
    const detector = new DetectorVoz(c.sampleRate, TAMANO);
    const medio = TAMANO / 2 / c.sampleRate; // la lectura se fecha en el centro de la ventana
    const s: Sesion = { mic, nodos: [] };

    let conWorklet = false;
    if (c.audioWorklet) {
      try {
        await cargarWorklet(c);
        conWorklet = true;
      } catch {
        // seguimos con AnalyserNode
      }
    }
    if (gen !== generacion.current) {
      mic.cerrar();
      return;
    }

    if (conWorklet) {
      const salto = Math.round(c.sampleRate * SALTO_SEG);
      const nodo = new AudioWorkletNode(c, "captura-pitch", {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        channelCount: 1,
        channelCountMode: "explicit",
        processorOptions: { salto },
      });
      // Salida silenciosa hacia destination solo para que el grafo lo procese.
      const mudo = c.createGain();
      mudo.gain.value = 0;
      const ventana = new Float32Array(TAMANO);
      let recibidas = 0;
      nodo.port.onmessage = (ev: MessageEvent<{ datos: Float32Array; tFin: number }>) => {
        const { datos, tFin } = ev.data;
        const n = Math.min(datos.length, TAMANO);
        ventana.copyWithin(0, n);
        ventana.set(datos.subarray(datos.length - n), TAMANO - n);
        recibidas += n;
        if (recibidas < TAMANO) return;
        registrar(detector.procesar(ventana), tFin - medio);
      };
      mic.fuente.connect(nodo);
      nodo.connect(mudo);
      mudo.connect(c.destination);
      s.nodos.push(nodo, mudo);
    } else {
      const analizador = c.createAnalyser();
      analizador.fftSize = TAMANO;
      mic.fuente.connect(analizador); // sin conectar a destination
      const buf = new Float32Array(TAMANO);
      let tPrevio = -1;
      s.intervalo = setInterval(() => {
        const t = c.currentTime;
        if (t === tPrevio) return; // el audio no ha avanzado
        tPrevio = t;
        analizador.getFloatTimeDomainData(buf);
        registrar(detector.procesar(buf), t - medio);
      }, SALTO_SEG * 1000);
      s.nodos.push(analizador);
    }

    mic.stream.getAudioTracks()[0]?.addEventListener("ended", () => {
      if (sesion.current !== s) return;
      detener();
      setError("Se ha desconectado el micrófono.");
    });

    sesion.current = s;
    hist.current = [];
    setHistorial([]);
    setCtx(c);
    setActivo(true);
  }, [registrar, detener]);

  // Publica el estado a ~30 Hz como máximo (las lecturas llegan a ~100 Hz).
  useEffect(() => {
    if (!activo) return;
    const id = setInterval(() => {
      if (!sucio.current) return;
      sucio.current = false;
      setUltimo(ultimoRef.current);
      setHistorial(hist.current.slice());
    }, MS_PUBLICAR);
    return () => clearInterval(id);
  }, [activo]);

  // Al desmontar: soltar micrófono y nodos
  useEffect(
    () => () => {
      generacion.current++;
      liberar();
      grab.current = null;
    },
    [liberar],
  );

  const iniciarGrabacion = useCallback((t0: number) => {
    grab.current = { t0, puntos: [] };
  }, []);

  const detenerGrabacion = useCallback((): Contorno => {
    const puntos = grab.current?.puntos ?? [];
    grab.current = null;
    return puntos;
  }, []);

  return { activo, error, ultimo, historial, ctx, iniciar, detener, iniciarGrabacion, detenerGrabacion };
}
