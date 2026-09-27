// Motor de consejos basado en reglas (DISENO §4.2).

import type { Consejo, Metricas } from "../tipos";

interface Regla {
  id: string;
  titulo: string;
  ejercicio: string;
  /** Devuelve el mensaje y la gravedad si la regla se cumple. */
  evaluar: (m: Metricas) => { mensaje: string; gravedad: number } | undefined;
}

/**
 * Gravedad proporcional a cuánto se supera el umbral: 1 justo en el umbral,
 * 2 al superarlo en una `escala` completa. `peso` prioriza unas reglas sobre otras.
 */
function gravedad(exceso: number, escala: number, peso = 1): number {
  return peso * (1 + Math.max(0, exceso) / escala);
}

const hayNotas = (m: Metricas) => m.pctNotasOmitidas < 100;

const REGLAS: Regla[] = [
  {
    id: "omisiones",
    titulo: "Te saltas notas",
    ejercicio: "Canta la frase más despacio o tararéala primero; marca en la letra dónde respirar para llegar a todas las notas.",
    evaluar: (m) =>
      m.pctNotasOmitidas > 20
        ? {
            mensaje: `No se te oye en el ${Math.round(m.pctNotasOmitidas)} % de las notas. Revisa que el micrófono te capte bien y no te quedes callado en los pasajes difíciles.`,
            gravedad: gravedad(m.pctNotasOmitidas - 20, 20, 1.3),
          }
        : undefined,
  },
  {
    id: "calado",
    titulo: "Cantas bajo (calado)",
    ejercicio: "Escalas ascendentes con buen apoyo respiratorio, pensando cada nota «por encima» de donde crees que está.",
    evaluar: (m) => {
      if (!hayNotas(m) || m.sesgoCents >= -15) return undefined;
      const r = m.errorPorRegistro;
      const agudo = r.agudo > Math.max(r.medio, r.grave) + 10 ? ", sobre todo en el agudo" : "";
      return {
        mensaje: `Tiendes a cantar bajo (calado)${agudo}: de media ${Math.round(-m.sesgoCents)} cents por debajo.`,
        gravedad: gravedad(-m.sesgoCents - 15, 15, 1.2),
      };
    },
  },
  {
    id: "sostenido",
    titulo: "Cantas alto (sostenido)",
    ejercicio: "Relaja la tensión de la garganta y canta notas largas a volumen medio, sin empujar.",
    evaluar: (m) =>
      hayNotas(m) && m.sesgoCents > 15
        ? {
            mensaje: `Tiendes a cantar alto (sostenido): de media ${Math.round(m.sesgoCents)} cents por encima.`,
            gravedad: gravedad(m.sesgoCents - 15, 15, 1.2),
          }
        : undefined,
  },
  {
    id: "irregular",
    titulo: "Afinación irregular",
    ejercicio: "Canta la melodía nota a nota con el afinador en pantalla y repite despacio los pasajes marcados en rojo.",
    evaluar: (m) =>
      hayNotas(m) && m.errorMedioCents > 30 && Math.abs(m.sesgoCents) <= 15
        ? {
            mensaje: `Unas notas te quedan altas y otras bajas (error medio de ${Math.round(m.errorMedioCents)} cents). Afianza bien cada nota antes de ir a por la siguiente.`,
            gravedad: gravedad(m.errorMedioCents - 30, 30, 1.1),
          }
        : undefined,
  },
  {
    id: "oscila",
    titulo: "Las notas oscilan",
    ejercicio: "Notas tenidas de 8 segundos mirando el afinador, con el aire saliendo de forma constante.",
    evaluar: (m) =>
      hayNotas(m) && m.estabilidadCents > 25
        ? {
            mensaje: "Tus notas largas oscilan: cuesta mantener la altura quieta en la parte sostenida.",
            gravedad: gravedad(m.estabilidadCents - 25, 25),
          }
        : undefined,
  },
  {
    id: "se-caen",
    titulo: "Las notas se caen",
    ejercicio: "Control del aire con messa di voce: crece y decrece el volumen sin que se mueva la nota.",
    evaluar: (m) =>
      hayNotas(m) && m.derivaCentsPorSeg < -20
        ? {
            mensaje: "Las notas largas se caen al final: vas perdiendo altura a medida que se acaba el aire.",
            gravedad: gravedad(-m.derivaCentsPorSeg - 20, 20),
          }
        : undefined,
  },
  {
    id: "se-suben",
    titulo: "Las notas se suben",
    ejercicio: "Notas largas a volumen medio sin apretar; si notas que empujas, suelta un poco el aire.",
    evaluar: (m) =>
      hayNotas(m) && m.derivaCentsPorSeg > 20
        ? {
            mensaje: "Las notas largas se te van hacia arriba mientras las sostienes.",
            gravedad: gravedad(m.derivaCentsPorSeg - 20, 20, 0.9),
          }
        : undefined,
  },
  {
    id: "scoop",
    titulo: "Entras desde abajo",
    ejercicio: "Ataques limpios en staccato: imagina la nota antes de cantarla y cae justo encima.",
    evaluar: (m) =>
      hayNotas(m) && m.pctScoop > 40
        ? {
            mensaje: `Entras en las notas desde abajo (en el ${Math.round(m.pctScoop)} % de ellas) y luego subes a buscarlas.`,
            gravedad: gravedad(m.pctScoop - 40, 40),
          }
        : undefined,
  },
  {
    id: "ataque-lento",
    titulo: "Tardas en afinar al entrar",
    ejercicio: "Ataques cortos sobre una sola nota con el afinador: busca que la aguja se quede quieta desde el principio.",
    evaluar: (m) =>
      hayNotas(m) && m.ataqueMedioMs > 150
        ? {
            mensaje: `Tardas unos ${Math.round(m.ataqueMedioMs)} ms en colocar la nota después de entrar.`,
            gravedad: gravedad(m.ataqueMedioMs - 150, 150, 0.8),
          }
        : undefined,
  },
  {
    id: "tarde",
    titulo: "Entras tarde",
    ejercicio: "Practica con metrónomo y toma el aire un poco antes de cada entrada.",
    evaluar: (m) =>
      hayNotas(m) && m.retrasoEntradaMedioMs > 80
        ? {
            mensaje: `Entras tarde de forma sistemática (unos ${Math.round(m.retrasoEntradaMedioMs)} ms).`,
            gravedad: gravedad(m.retrasoEntradaMedioMs - 80, 80),
          }
        : undefined,
  },
  {
    id: "adelantas",
    titulo: "Te adelantas",
    ejercicio: "Practica con metrónomo marcando el pulso con el pie y espera a que llegue cada tiempo.",
    evaluar: (m) =>
      hayNotas(m) && m.retrasoEntradaMedioMs < -80
        ? {
            mensaje: `Te adelantas a las entradas (unos ${Math.round(-m.retrasoEntradaMedioMs)} ms antes de tiempo).`,
            gravedad: gravedad(-m.retrasoEntradaMedioMs - 80, 80),
          }
        : undefined,
  },
  {
    id: "cortas",
    titulo: "Cortas las notas",
    ejercicio: "Sostén cada nota hasta el final de su valor y respira solo donde lo marca la frase.",
    evaluar: (m) =>
      hayNotas(m) && m.duracionRelativa < 0.85
        ? {
            mensaje: `Cortas las notas antes de tiempo: las sostienes un ${Math.round(m.duracionRelativa * 100)} % de lo que duran.`,
            gravedad: gravedad(0.85 - m.duracionRelativa, 0.15),
          }
        : undefined,
  },
  {
    id: "saltos",
    titulo: "Los saltos te cuestan",
    ejercicio: "Ejercicios de intervalos (3ª, 5ª y 8ª): canta primero las notas de paso y luego el salto directo.",
    evaluar: (m) => {
      const umbral = Math.max(2 * m.errorGradosConjuntosCents, 30);
      return hayNotas(m) && m.errorSaltosCents > umbral
        ? {
            mensaje: `Los saltos grandes te cuestan: fallas el intervalo en ${Math.round(m.errorSaltosCents)} cents de media, bastante más que en los pasos cortos.`,
            gravedad: gravedad(m.errorSaltosCents - umbral, umbral),
          }
        : undefined;
    },
  },
  {
    id: "agudo",
    titulo: "El agudo se resiente",
    ejercicio: "Trabaja el paso de registro con sirenas suaves; mientras tanto, prueba a transponer −2 semitonos.",
    evaluar: (m) => {
      const r = m.errorPorRegistro;
      const umbral = Math.max(2 * r.medio, 25);
      return hayNotas(m) && r.agudo > umbral
        ? {
            mensaje: "Pierdes precisión en el registro agudo respecto a la zona media de tu voz.",
            gravedad: gravedad(r.agudo - umbral, umbral),
          }
        : undefined;
    },
  },
  {
    id: "vibrato-rapido",
    titulo: "Vibrato demasiado rápido",
    ejercicio: "Relaja la mandíbula y la lengua; practica un vibrato lento y controlado (4–5 ondas por segundo) y acelera poco a poco.",
    evaluar: (m) =>
      m.vibratoMedio && m.vibratoMedio.hz > 7
        ? {
            mensaje: `Tu vibrato va rápido (${m.vibratoMedio.hz.toFixed(1)} ondulaciones por segundo); suele sonar a tensión.`,
            gravedad: gravedad(m.vibratoMedio.hz - 7, 1, 0.8),
          }
        : undefined,
  },
  {
    id: "vibrato-lento",
    titulo: "Vibrato demasiado lento",
    ejercicio: "Notas largas con más apoyo de aire; deja que el vibrato surja solo, sin fabricarlo con la garganta.",
    evaluar: (m) =>
      m.vibratoMedio && m.vibratoMedio.hz < 4.5
        ? {
            mensaje: `Tu vibrato es lento (${m.vibratoMedio.hz.toFixed(1)} ondulaciones por segundo) y puede sonar a oscilación.`,
            gravedad: gravedad(4.5 - m.vibratoMedio.hz, 1, 0.8),
          }
        : undefined,
  },
  {
    id: "vibrato-amplio",
    titulo: "Vibrato demasiado amplio",
    ejercicio: "Alterna nota recta y nota con vibrato suave; busca que la ondulación no pase de un cuarto de tono.",
    evaluar: (m) =>
      m.vibratoMedio && m.vibratoMedio.amplitudCents > 80
        ? {
            mensaje: `Tu vibrato es muy ancho (±${Math.round(m.vibratoMedio.amplitudCents)} cents) y difumina la nota.`,
            gravedad: gravedad(m.vibratoMedio.amplitudCents - 80, 80, 0.8),
          }
        : undefined,
  },
];

const POSITIVO: Consejo = {
  id: "bien",
  gravedad: 0,
  titulo: "¡Muy bien!",
  mensaje: "Afinación, estabilidad y ritmo están en buen nivel. ¡Sigue así!",
  ejercicio: "Sube un nivel de exigencia o prueba una canción con más saltos y notas largas.",
};

export function generarConsejos(m: Metricas, maximo = 3): Consejo[] {
  const consejos: Consejo[] = [];
  for (const r of REGLAS) {
    const res = r.evaluar(m);
    if (res) consejos.push({ id: r.id, titulo: r.titulo, ejercicio: r.ejercicio, ...res });
  }
  if (consejos.length === 0) return [{ ...POSITIVO }].slice(0, Math.max(0, maximo));
  consejos.sort((a, b) => b.gravedad - a.gravedad);
  return consejos.slice(0, Math.max(0, maximo));
}
