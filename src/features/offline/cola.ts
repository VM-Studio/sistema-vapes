import {
  abrirDb,
  avisarCambioCola,
  type EstadoCola,
  type OperacionCola,
  type TipoOperacion,
} from "./db";

/**
 * Cola de operaciones hechas sin conexión (solo Ingresar, Contar y Transferir;
 * las ventas NUNCA: necesitan validar stock y cobrar en tiempo real).
 *
 * Cada operación lleva un `idOperacion` (UUID v4 del celular). Se envían en
 * orden a /api/sync, que es idempotente: reenviar la misma operación (dos
 * pestañas, el service worker y la página a la vez, un corte a mitad de la
 * respuesta) no repite movimientos. Las aplicadas salen de la cola; las
 * rechazadas quedan a la vista con su motivo hasta que alguien decida.
 */

export const TAG_SYNC = "cola-escaner";

export async function encolar(
  tipo: TipoOperacion,
  payload: unknown,
  usuarioId: string,
  resumen: string,
): Promise<OperacionCola> {
  const op: OperacionCola = {
    idOperacion: crypto.randomUUID(),
    tipo,
    payload,
    creadaEn: new Date().toISOString(),
    usuarioId,
    estado: "PENDIENTE",
    intentos: 0,
    resumen,
  };
  await (await abrirDb()).put("cola", op);
  avisarCambioCola();
  await pedirBackgroundSync();
  return op;
}

/** Background Sync API (Chrome/Android): el SO despierta al service worker cuando vuelve la red. */
export async function pedirBackgroundSync(): Promise<void> {
  try {
    const reg = await navigator.serviceWorker?.ready;
    const sync = (
      reg as ServiceWorkerRegistration & { sync?: { register(tag: string): Promise<void> } }
    )?.sync;
    await sync?.register(TAG_SYNC);
  } catch {
    /* sin soporte: queda el evento online + polling de 30 s */
  }
}

export async function listarCola(): Promise<OperacionCola[]> {
  try {
    return await (await abrirDb()).getAllFromIndex("cola", "porCreada");
  } catch {
    return [];
  }
}

export async function contarCola(): Promise<{ pendientes: number; rechazadas: number }> {
  const ops = await listarCola();
  return {
    pendientes: ops.filter((o) => o.estado !== "RECHAZADA").length,
    rechazadas: ops.filter((o) => o.estado === "RECHAZADA").length,
  };
}

async function cambiarEstado(id: string, cambios: Partial<OperacionCola>) {
  const db = await abrirDb();
  const op = await db.get("cola", id);
  if (op) await db.put("cola", { ...op, ...cambios });
}

export interface ResultadoRemoto {
  idOperacion: string;
  estado: "APLICADA" | "RECHAZADA" | "PROCESANDO";
  motivo?: string | null;
  repetida: boolean;
}

export interface ResumenSincronizacion {
  enviadas: number;
  aplicadas: number;
  rechazadas: number;
  sinRed: boolean;
  sinSesion: boolean;
}

let enCurso: Promise<ResumenSincronizacion> | null = null;

/**
 * Envía las pendientes en orden. Una sola corrida a la vez por contexto (y
 * Web Locks entre pestañas / service worker cuando existe); igual el servidor
 * es idempotente, así que una doble corrida no duplica nada.
 */
export function sincronizarCola(
  fetchFn: typeof fetch = (...a) => fetch(...a),
): Promise<ResumenSincronizacion> {
  enCurso ??= (async () => {
    const correr = () => enviar(fetchFn);
    const locks = (globalThis.navigator as Navigator | undefined)?.locks;
    try {
      return locks ? await locks.request(TAG_SYNC, correr) : await correr();
    } finally {
      enCurso = null;
    }
  })();
  return enCurso;
}

async function enviar(fetchFn: typeof fetch): Promise<ResumenSincronizacion> {
  const resumen: ResumenSincronizacion = {
    enviadas: 0,
    aplicadas: 0,
    rechazadas: 0,
    sinRed: false,
    sinSesion: false,
  };
  const db = await abrirDb();
  const pendientes = (await db.getAllFromIndex("cola", "porCreada")).filter(
    (o) => o.estado !== "RECHAZADA",
  );
  if (pendientes.length === 0) return resumen;
  for (let i = 0; i < pendientes.length; i += 20) {
    const lote = pendientes.slice(i, i + 20);
    for (const op of lote)
      await cambiarEstado(op.idOperacion, { estado: "ENVIANDO" satisfies EstadoCola });
    let res: Response;
    try {
      res = await fetchFn("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          operaciones: lote.map((o) => ({
            idOperacion: o.idOperacion,
            tipo: o.tipo,
            creadaEn: o.creadaEn,
            usuarioId: o.usuarioId,
            payload: o.payload,
          })),
        }),
      });
    } catch {
      for (const op of lote)
        await cambiarEstado(op.idOperacion, { estado: "PENDIENTE", intentos: op.intentos + 1 });
      resumen.sinRed = true;
      break;
    }
    if (res.status === 401 || res.status === 403) {
      for (const op of lote) await cambiarEstado(op.idOperacion, { estado: "PENDIENTE" });
      resumen.sinSesion = res.status === 401;
      break;
    }
    if (!res.ok) {
      for (const op of lote)
        await cambiarEstado(op.idOperacion, { estado: "PENDIENTE", intentos: op.intentos + 1 });
      resumen.sinRed = true;
      break;
    }
    const cuerpo = (await res.json()) as { data: { resultados: ResultadoRemoto[] } };
    for (const r of cuerpo.data.resultados) {
      resumen.enviadas++;
      if (r.estado === "APLICADA") {
        resumen.aplicadas++;
        await db.delete("cola", r.idOperacion);
      } else if (r.estado === "RECHAZADA") {
        resumen.rechazadas++;
        await cambiarEstado(r.idOperacion, {
          estado: "RECHAZADA",
          motivo: r.motivo ?? "Rechazada",
        });
      } else {
        await cambiarEstado(r.idOperacion, { estado: "PENDIENTE" });
      }
    }
  }
  avisarCambioCola();
  return resumen;
}

/** Una rechazada se descarta solo a mano (el usuario ya la resolvió). */
export async function descartar(idOperacion: string): Promise<void> {
  const db = await abrirDb();
  const op = await db.get("cola", idOperacion);
  if (op?.estado === "RECHAZADA") await db.delete("cola", idOperacion);
  avisarCambioCola();
}

/** Reintentar una rechazada es una operación NUEVA (id nuevo): la anterior ya tiene respuesta definitiva. */
export async function reintentar(idOperacion: string): Promise<void> {
  const db = await abrirDb();
  const op = await db.get("cola", idOperacion);
  if (!op || op.estado !== "RECHAZADA") return;
  await db.delete("cola", idOperacion);
  await db.put("cola", {
    ...op,
    idOperacion: crypto.randomUUID(),
    estado: "PENDIENTE",
    motivo: null,
    intentos: 0,
    creadaEn: new Date().toISOString(),
  });
  avisarCambioCola();
}
