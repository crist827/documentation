// Persistencia local (IndexedDB) con Dexie: referencias analizadas y sesiones.
import Dexie, { type EntityTable } from "dexie";
import type { Informe, Metricas, Nivel, Referencia } from "./tipos";

export interface PistaInfo {
  indice: number;
  nombre: string;
  numNotas: number;
  polifonia: number;
  alturaMedia: number;
}

/** Referencia guardada (sin AudioBuffer). */
export interface ReferenciaGuardada extends Referencia {
  fecha: number;
  /** Nombre del archivo original, si se guardó. */
  nombreArchivo?: string;
  /** Pistas del MIDI y la elegida (para poder reanalizar). */
  pistas?: PistaInfo[];
  pista?: number;
}

/** Archivo original, en tabla aparte para no cargarlo al listar. */
interface ArchivoGuardado {
  id: string;
  nombre: string;
  mime: string;
  datos: ArrayBuffer;
}

export interface Sesion {
  id?: number;
  fecha: number;
  referenciaId: string;
  referenciaNombre: string;
  puntuacion: number;
  desglose: Informe["desglose"];
  metricas: Metricas;
  nivel?: Nivel;
  modo?: Informe["opciones"]["modo"];
}

class BaseDatos extends Dexie {
  referencias!: EntityTable<ReferenciaGuardada, "id">;
  archivos!: EntityTable<ArchivoGuardado, "id">;
  sesiones!: EntityTable<Sesion, "id">;

  constructor() {
    super("entrenador-vocal");
    this.version(1).stores({
      referencias: "id, fecha, nombre",
      archivos: "id",
      sesiones: "++id, fecha, referenciaId",
    });
  }
}

let db: BaseDatos | null = null;
function base(): BaseDatos {
  if (!db) db = new BaseDatos();
  return db;
}

export interface ExtrasReferencia {
  archivo?: File;
  pistas?: PistaInfo[];
  pista?: number;
}

export async function guardarReferencia(ref: Referencia, extras: ExtrasReferencia = {}): Promise<void> {
  const b = base();
  const fila: ReferenciaGuardada = {
    ...ref,
    fecha: Date.now(),
    nombreArchivo: extras.archivo?.name,
    pistas: extras.pistas,
    pista: extras.pista,
  };
  const datos = extras.archivo ? await extras.archivo.arrayBuffer() : null;
  await b.transaction("rw", b.referencias, b.archivos, async () => {
    await b.referencias.put(fila);
    if (datos && extras.archivo)
      await b.archivos.put({ id: ref.id, nombre: extras.archivo.name, mime: extras.archivo.type, datos });
  });
}

/** Referencias guardadas, de la más reciente a la más antigua. */
export async function listarReferencias(): Promise<ReferenciaGuardada[]> {
  return base().referencias.orderBy("fecha").reverse().toArray();
}

export async function borrarReferencia(id: string): Promise<void> {
  const b = base();
  await b.transaction("rw", b.referencias, b.archivos, async () => {
    await b.referencias.delete(id);
    await b.archivos.delete(id);
  });
}

/** Archivo original de una referencia como File (o null si no se guardó). */
export async function obtenerArchivo(id: string): Promise<File | null> {
  const a = await base().archivos.get(id);
  return a ? new File([a.datos], a.nombre, { type: a.mime }) : null;
}

export async function guardarSesion(informe: Informe): Promise<number> {
  const id = await base().sesiones.add({
    fecha: informe.fecha,
    referenciaId: informe.referenciaId,
    referenciaNombre: informe.referenciaNombre,
    puntuacion: informe.puntuacion,
    desglose: informe.desglose,
    metricas: informe.metricas,
    nivel: informe.opciones.nivel,
    modo: informe.opciones.modo,
  });
  return id as number;
}

/** Sesiones en orden cronológico (de la más antigua a la más reciente). */
export async function listarSesiones(referenciaId?: string): Promise<Sesion[]> {
  const b = base();
  const filas = referenciaId
    ? await b.sesiones.where("referenciaId").equals(referenciaId).toArray()
    : await b.sesiones.toArray();
  return filas.sort((x, y) => x.fecha - y.fecha);
}

export async function borrarSesion(id: number): Promise<void> {
  await base().sesiones.delete(id);
}
