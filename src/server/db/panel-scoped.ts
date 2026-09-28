import { Prisma, type PrismaClient } from "@prisma/client";

import { esErrorReintentable, prisma, type TransactionOptions, type Tx } from "@/lib/db";
import type { RequestMeta } from "@/server/auth/request-meta";

/**
 * AISLAMIENTO ENTRE PANELES
 *
 * Cada panel (Vapes, Cosmetic, ...) es un sistema independiente: ninguna
 * query de negocio puede ver ni tocar datos de otro. `dbPara(panelId)` es un
 * PrismaClient extendido que, para TODO modelo con columna `panelId`:
 *
 *  - lecturas, updates y deletes: agrega `panelId` al `where` (también en
 *    findUnique/update/delete por id: un id de otro panel da "no encontrado");
 *  - creates (incluidos createMany, upsert y los nested create /
 *    createMany / connectOrCreate / upsert de relaciones): completa `panelId`;
 *  - si una query trae un `panelId` distinto (o un filtro que no sea una
 *    igualdad simple), LANZA: es un bug, no un caso a tolerar.
 *
 * Los servicios de negocio reciben `ctx: { panelId, usuarioId }` y usan solo
 * `dbPara(ctx.panelId)` / `transaccion(ctx, ...)`. ESLint prohíbe importar
 * `@/lib/db` (el cliente crudo) fuera de src/server/db y de los servicios
 * globales (auth, usuarios, paneles).
 *
 * Segunda red en la DB: panelId tiene DEFAULT current_setting('app.panel_id')
 * (nadie lo setea → un INSERT sin panel falla por NOT NULL) y triggers
 * verifican que cada fila apunte a filas de su mismo panel.
 *
 * Lo que la extensión NO cubre: `$queryRaw` / `$executeRaw`. Toda SQL cruda
 * de un servicio de negocio tiene que filtrar por `ctx.panelId` a mano.
 */

/** Contexto de toda operación de negocio: en qué panel y quién. */
export interface Ctx {
  panelId: string;
  usuarioId: string;
  meta?: RequestMeta;
}

export class PanelAislamientoError extends Error {
  constructor(detalle: string) {
    super(`Aislamiento de paneles: ${detalle}`);
    this.name = "PanelAislamientoError";
  }
}

// -----------------------------------------------------------------------------
// Metadatos del modelo (del DMMF de Prisma: sin listas a mano que se desactualicen)
// -----------------------------------------------------------------------------

/** Tablas globales de usuarios: tienen panelId pero las administran los servicios de auth/usuarios. */
const MODELOS_GLOBALES = new Set(["PermisoUsuario", "UsuarioPanel"]);

const MODELOS = Prisma.dmmf.datamodel.models;

export const MODELOS_CON_PANEL: ReadonlySet<string> = new Set(
  MODELOS.filter(
    (m) => !MODELOS_GLOBALES.has(m.name) && m.fields.some((f) => f.name === "panelId"),
  ).map((m) => m.name),
);

/** modelo → (campo de relación → modelo relacionado), solo hacia modelos con panel. */
const RELACIONES = new Map<string, Map<string, string>>(
  MODELOS.map((m) => [
    m.name,
    new Map(
      m.fields
        .filter((f) => f.kind === "object" && MODELOS_CON_PANEL.has(f.type))
        .map((f) => [f.name, f.type]),
    ),
  ]),
);

// -----------------------------------------------------------------------------
// Inyección
// -----------------------------------------------------------------------------

type Objeto = Record<string, unknown>;
const esObjeto = (v: unknown): v is Objeto =>
  typeof v === "object" && v !== null && !Array.isArray(v) && !(v instanceof Date);

function verificarValor(modelo: string, valor: unknown, panelId: string): void {
  if (valor === undefined) return;
  if (valor !== panelId) {
    throw new PanelAislamientoError(
      `${modelo} recibió panelId ${JSON.stringify(valor)} dentro del panel ${panelId}.`,
    );
  }
}

function conPanelEnWhere(modelo: string, where: unknown, panelId: string): Objeto {
  const w = esObjeto(where) ? where : {};
  verificarValor(modelo, w.panelId, panelId);
  return { ...w, panelId };
}

/** Completa panelId en `data` y, recursivamente, en las escrituras anidadas. */
function conPanelEnData(
  modelo: string,
  data: unknown,
  panelId: string,
  esCreate: boolean,
): unknown {
  if (Array.isArray(data)) return data.map((d) => conPanelEnData(modelo, d, panelId, esCreate));
  if (!esObjeto(data)) return data;

  const salida: Objeto = { ...data };
  if (MODELOS_CON_PANEL.has(modelo)) {
    verificarValor(modelo, salida.panelId, panelId);
    // Si se conecta la relación `panel`, que sea este panel.
    const panelRel = salida.panel;
    if (esObjeto(panelRel)) {
      const conectado = esObjeto(panelRel.connect) ? panelRel.connect.id : undefined;
      verificarValor(modelo, conectado, panelId);
      if (panelRel.create || panelRel.connectOrCreate) {
        throw new PanelAislamientoError(`${modelo} no puede crear un Panel anidado.`);
      }
    } else if (esCreate) {
      salida.panelId = panelId;
    }
  }

  const relaciones = RELACIONES.get(modelo);
  if (!relaciones) return salida;
  for (const [campo, destino] of relaciones) {
    const op = salida[campo];
    if (!esObjeto(op)) continue;
    const anidada: Objeto = { ...op };
    if (anidada.create !== undefined)
      anidada.create = conPanelEnData(destino, anidada.create, panelId, true);
    if (esObjeto(anidada.createMany)) {
      anidada.createMany = {
        ...anidada.createMany,
        data: conPanelEnData(destino, anidada.createMany.data, panelId, true),
      };
    }
    if (anidada.connectOrCreate !== undefined) {
      const lista = Array.isArray(anidada.connectOrCreate)
        ? anidada.connectOrCreate
        : [anidada.connectOrCreate];
      const procesada = lista.map((c) =>
        esObjeto(c)
          ? {
              ...c,
              where: conPanelEnWhere(destino, c.where, panelId),
              create: conPanelEnData(destino, c.create, panelId, true),
            }
          : c,
      );
      anidada.connectOrCreate = Array.isArray(anidada.connectOrCreate) ? procesada : procesada[0];
    }
    if (anidada.upsert !== undefined) {
      const lista = Array.isArray(anidada.upsert) ? anidada.upsert : [anidada.upsert];
      const procesada = lista.map((u) =>
        esObjeto(u)
          ? {
              ...u,
              create: conPanelEnData(destino, u.create, panelId, true),
              update: conPanelEnData(destino, u.update, panelId, false),
            }
          : u,
      );
      anidada.upsert = Array.isArray(anidada.upsert) ? procesada : procesada[0];
    }
    if (anidada.update !== undefined) {
      const lista = Array.isArray(anidada.update) ? anidada.update : [anidada.update];
      const procesada = lista.map((u) =>
        esObjeto(u) && "data" in u
          ? { ...u, data: conPanelEnData(destino, u.data, panelId, false) }
          : conPanelEnData(destino, u, panelId, false),
      );
      anidada.update = Array.isArray(anidada.update) ? procesada : procesada[0];
    }
    salida[campo] = anidada;
  }
  return salida;
}

const OPERACIONES_CON_WHERE = new Set([
  "findUnique",
  "findUniqueOrThrow",
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "count",
  "aggregate",
  "groupBy",
  "update",
  "updateMany",
  "updateManyAndReturn",
  "delete",
  "deleteMany",
  "upsert",
]);

function crearCliente(panelId: string): PrismaClient {
  const extendido = prisma.$extends({
    name: `panel:${panelId}`,
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!MODELOS_CON_PANEL.has(model)) {
            // Igual hay que completar panelId en los nested create hacia modelos con panel.
            if (esObjeto(args) && "data" in args) {
              const a = args as Objeto;
              a.data = conPanelEnData(model, a.data, panelId, operation.startsWith("create"));
            }
            return query(args);
          }
          const a: Objeto = esObjeto(args) ? { ...args } : {};
          if (OPERACIONES_CON_WHERE.has(operation))
            a.where = conPanelEnWhere(model, a.where, panelId);
          switch (operation) {
            case "create":
            case "createMany":
            case "createManyAndReturn":
              a.data = conPanelEnData(model, a.data, panelId, true);
              break;
            case "update":
            case "updateMany":
            case "updateManyAndReturn":
              a.data = conPanelEnData(model, a.data, panelId, false);
              break;
            case "upsert":
              a.create = conPanelEnData(model, a.create, panelId, true);
              a.update = conPanelEnData(model, a.update, panelId, false);
              break;
          }
          return query(a as typeof args);
        },
      },
    },
  });
  // La extensión solo toca argumentos: la API y los tipos son los de PrismaClient.
  return extendido as unknown as PrismaClient;
}

const clientes = new Map<string, PrismaClient>();

/** Cliente de Prisma confinado a un panel (cacheado por panel). */
export function dbPara(panelId: string): PrismaClient {
  if (!panelId) throw new PanelAislamientoError("dbPara() sin panelId.");
  let cliente = clientes.get(panelId);
  if (!cliente) {
    cliente = crearCliente(panelId);
    clientes.set(panelId, cliente);
  }
  return cliente;
}

/**
 * Transacción interactiva confinada al panel del contexto: Serializable por
 * defecto y con reintentos ante conflictos (mismo contrato que withTransaction).
 * Todo lo que mueve stock pasa por acá.
 */
export async function transaccion<T>(
  ctx: Pick<Ctx, "panelId">,
  fn: (tx: Tx) => Promise<T>,
  options: TransactionOptions = {},
): Promise<T> {
  const {
    isolationLevel = Prisma.TransactionIsolationLevel.Serializable,
    // Serializable + numeración por panel (fila de Secuencia): con varias cajas a la vez
    // los conflictos son normales y se resuelven reintentando.
    maxRetries = 10,
    maxWait = 5_000,
    timeout = 15_000,
  } = options;
  const db = dbPara(ctx.panelId);
  for (let intento = 0; ; intento++) {
    try {
      return await db.$transaction(fn, { isolationLevel, maxWait, timeout });
    } catch (error) {
      if (intento < maxRetries && esErrorReintentable(error)) {
        await new Promise((r) => setTimeout(r, 10 + Math.random() * 40));
        continue;
      }
      throw error;
    }
  }
}

/** Usa la transacción recibida (si la hay) o abre una del panel. */
export function enTransaccion<T>(
  ctx: Pick<Ctx, "panelId">,
  tx: Tx | undefined,
  fn: (tx: Tx) => Promise<T>,
  options?: TransactionOptions,
): Promise<T> {
  return tx ? fn(tx) : transaccion(ctx, fn, options);
}

export type { Tx, TransactionOptions };
