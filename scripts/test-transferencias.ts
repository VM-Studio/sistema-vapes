/**
 * Ingreso distribuido y transferencias con pistola + remito (A1, puntos 5 y 6)
 * contra una base DESCARTABLE (requiere el seed base; siembra el catálogo de ejemplo).
 * Uso: DATABASE_URL=… DIRECT_URL=… STORAGE_DIR=… pnpm test:transferencias
 *
 * 5) Carga de 200 unidades (4 sabores) con galpón de ingreso Ayres Plaza,
 *    distribuida 150 Ayres Plaza / 50 Mercedes → un INGRESO_MANUAL por
 *    (sabor, depósito); Global 150 | 50 | 200. Distribuciones inválidas
 *    rechazadas sin mover nada.
 * 6) Transferencia de 20 unidades Ayres Plaza → Mercedes ("Mover ahora") →
 *    SALIDA + ENTRADA por sabor, código VAP-T-000001 (en una base nueva),
 *    remito PDF con marca/modelo/pitadas/sabor/cantidad y firmas; el total
 *    Global no cambia. 500 unidades → falla entera sin mover nada.
 */
import { inflateSync } from "node:zlib";

import { RolUsuario, TipoMovimiento } from "@prisma/client";

import { prisma } from "../src/lib/db";
import { cargarStockSchema, productoSchema } from "../src/lib/validations/producto";
import { formatearIdTransferencia } from "../src/lib/validations/transferencia";
import { dbPara, type Ctx } from "../src/server/db/panel-scoped";
import { DomainError } from "../src/server/errors";
import {
  cargarStockPorEscaneo,
  crear as crearProducto,
} from "../src/server/services/producto.service";
import { stockGlobal } from "../src/server/services/stock.service";
import {
  completarTransferencia,
  crearYCompletarTransferencia,
  obtenerTransferencia,
  registrarEnvioTransferencia,
} from "../src/server/services/transferencia.service";
import { claveDeUrl, obtenerStorage } from "../src/server/storage";
import { sembrarCatalogoEjemplo } from "../e2e/fixtures/catalogo-ejemplo";

const VAPES = "pnl_vapes";
const db = dbPara(VAPES);
let fallos = 0;

function check(cond: boolean, msg: string) {
  if (cond) console.log(`  ✔ ${msg}`);
  else {
    fallos++;
    console.log(`  ✘ ${msg}`);
  }
}

async function error(fn: () => Promise<unknown>): Promise<unknown> {
  try {
    await fn();
    return null;
  } catch (e) {
    return e;
  }
}
const mensaje = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Texto de un PDF de pdf-lib: infla los streams y decodifica los strings
 * (hex `<…> Tj` y literales `(…) Tj`) de las fuentes estándar (WinAnsi).
 */
function textoDePdf(bytes: Uint8Array): string {
  const buf = Buffer.from(bytes);
  const partes: string[] = [];
  let desde = 0;
  for (;;) {
    const i = buf.indexOf("stream", desde, "latin1");
    if (i < 0) break;
    let inicio = i + "stream".length;
    if (buf[inicio] === 0x0d) inicio++;
    if (buf[inicio] === 0x0a) inicio++;
    const fin = buf.indexOf("endstream", inicio, "latin1");
    if (fin < 0) break;
    const crudo = buf.subarray(inicio, fin);
    let contenido: string;
    try {
      contenido = inflateSync(crudo).toString("latin1");
    } catch {
      contenido = crudo.toString("latin1");
    }
    for (const m of contenido.matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g))
      partes.push(Buffer.from(m[1]!, "hex").toString("latin1"));
    for (const m of contenido.matchAll(/\(((?:[^()\\]|\\.)*)\)\s*Tj/g)) partes.push(m[1]!);
    desde = fin + "endstream".length;
  }
  return partes.join("\n");
}

async function main() {
  await sembrarCatalogoEjemplo();
  const owner = await prisma.usuario.findFirstOrThrow({
    where: { rol: RolUsuario.OWNER, deletedAt: null },
    orderBy: { createdAt: "asc" },
  });
  const ctx: Ctx & { usuario: { rol: RolUsuario } } = {
    panelId: VAPES,
    usuarioId: owner.id,
    meta: { ip: "127.0.0.1", userAgent: "test-transferencias" },
    usuario: { rol: RolUsuario.OWNER },
  };
  const buscar = (nombre: string) =>
    db.deposito.findUniqueOrThrow({ where: { panelId_nombre: { panelId: VAPES, nombre } } });
  const [ayres, mercedes] = [await buscar("Ayres Plaza"), await buscar("Mercedes")];

  // Producto nuevo (stock en 0) para que los totales sean exactos.
  const sufijo = String(Date.now()).slice(-6);
  const MARCA = `Transf ${sufijo}`;
  const SABORES = ["Mango", "Uva", "Menta", "Frutilla"] as const;
  const creado = await crearProducto(
    ctx,
    productoSchema.parse({
      marca: MARCA,
      modelo: "TX",
      especificacion: "6000",
      precioVenta: "10000",
      sabores: SABORES.map((sabor) => ({ sabor })),
    }),
  );
  const id = (sabor: string) => creado.variantes.find((v) => v.nombre === sabor)!.id;
  const q = `${MARCA} TX`;
  const global = async () => {
    const r = await stockGlobal(ctx, { q, pageSize: 100 });
    const filas = r.filas.filter((f) => f.productoId === creado.id);
    return {
      ayres: filas.reduce((a, f) => a + (f.porDeposito[ayres.id] ?? 0), 0),
      mercedes: filas.reduce((a, f) => a + (f.porDeposito[mercedes.id] ?? 0), 0),
      total: filas.reduce((a, f) => a + f.cantidad, 0),
      porSabor: new Map(filas.map((f) => [f.varianteId, f])),
    };
  };
  const movimientosDelProducto = () =>
    db.movimientoStock.count({ where: { variante: { productoId: creado.id } } });

  // ---------------------------------------------------------------------------
  console.log(
    `\n5) Carga de 200 u. (${SABORES.length} sabores) con ingreso en ${ayres.nombre}: 150 ${ayres.nombre} / 50 ${mercedes.nombre}`,
  );
  // Escaneado: Mango 60, Uva 60, Menta 40, Frutilla 40 = 200.
  const reparto = {
    Mango: [45, 15],
    Uva: [45, 15],
    Menta: [30, 10],
    Frutilla: [30, 10],
  } as const;

  // Distribuciones inválidas primero: no se mueve nada.
  const movsAntes = await movimientosDelProducto();
  const eSuma = await error(() =>
    cargarStockPorEscaneo(
      ctx,
      cargarStockSchema.parse({
        depositoId: ayres.id,
        items: [
          {
            varianteId: id("Mango"),
            cantidad: 60,
            distribucion: [
              { depositoId: ayres.id, cantidad: 45 },
              { depositoId: mercedes.id, cantidad: 10 },
            ],
          },
        ],
      }),
    ),
  );
  check(
    eSuma instanceof DomainError && eSuma.code === "DISTRIBUCION_INVALIDA",
    `fila que no suma lo escaneado (55 de 60) → rechazada: «${mensaje(eSuma)}»`,
  );
  const depCosmetic = await dbPara("pnl_cosmetic").deposito.findFirstOrThrow();
  const eAjeno = await error(() =>
    cargarStockPorEscaneo(ctx, {
      depositoId: ayres.id,
      items: [
        {
          varianteId: id("Mango"),
          distribucion: [
            { depositoId: ayres.id, cantidad: 5 },
            { depositoId: depCosmetic.id, cantidad: 5 },
          ],
        },
      ],
    }),
  );
  check(
    eAjeno instanceof DomainError,
    `distribución con un galpón de otro panel → rechazada: «${mensaje(eAjeno)}»`,
  );
  const cero = cargarStockSchema.safeParse({
    depositoId: ayres.id,
    items: [{ varianteId: id("Mango"), distribucion: [{ depositoId: ayres.id, cantidad: 0 }] }],
  });
  const eCero = await error(() =>
    cargarStockPorEscaneo(ctx, {
      depositoId: ayres.id,
      items: [{ varianteId: id("Mango"), distribucion: [{ depositoId: ayres.id, cantidad: 0 }] }],
    }),
  );
  check(
    !cero.success && eCero instanceof DomainError,
    `cantidad 0 en la distribución → rechazada (schema y servicio: «${mensaje(eCero)}»)`,
  );
  check(
    (await movimientosDelProducto()) === movsAntes,
    "ninguna distribución inválida movió stock",
  );

  const carga = await cargarStockPorEscaneo(
    ctx,
    cargarStockSchema.parse({
      depositoId: ayres.id,
      items: SABORES.map((s) => ({
        varianteId: id(s),
        cantidad: reparto[s][0] + reparto[s][1],
        distribucion: [
          { depositoId: ayres.id, cantidad: reparto[s][0] },
          { depositoId: mercedes.id, cantidad: reparto[s][1] },
        ],
      })),
    }),
  );
  const ingresos = await db.movimientoStock.findMany({
    where: { variante: { productoId: creado.id }, tipo: TipoMovimiento.INGRESO_MANUAL },
    select: { varianteId: true, depositoId: true, cantidad: true },
  });
  const unoPorPar = SABORES.every((s) =>
    [ayres, mercedes].every((d, k) => {
      const m = ingresos.filter((x) => x.varianteId === id(s) && x.depositoId === d.id);
      return m.length === 1 && m[0]!.cantidad === reparto[s][k];
    }),
  );
  check(
    ingresos.length === 8 && unoPorPar,
    `${ingresos.length} INGRESO_MANUAL: uno por (sabor, depósito) con su cantidad`,
  );
  check(
    carga.unidades === 200 &&
      carga.deposito.id === ayres.id &&
      carga.cargadoPorDeposito.map((d) => `${d.unidades} a ${d.nombre}`).join(" · ") ===
        `150 a ${ayres.nombre} · 50 a ${mercedes.nombre}`,
    `resumen de la carga: «${carga.cargadoPorDeposito.map((d) => `${d.unidades} a ${d.nombre}`).join(" · ")}» (${carga.unidades} u.)`,
  );
  let g = await global();
  check(
    g.ayres === 150 && g.mercedes === 50 && g.total === 200,
    `Global: ${ayres.nombre} ${g.ayres} | ${mercedes.nombre} ${g.mercedes} | Total ${g.total}`,
  );
  const simple = await cargarStockPorEscaneo(ctx, {
    depositoId: mercedes.id,
    items: [{ varianteId: id("Menta"), cantidad: 2 }],
  });
  check(
    simple.cargadoPorDeposito.length === 1 &&
      simple.cargadoPorDeposito[0]!.depositoId === mercedes.id &&
      simple.items[0]?.distribucion[0]?.cantidad === 2,
    "la firma vieja (depositoId + items) sigue andando: 2 Menta a Mercedes",
  );
  g = await global();

  // ---------------------------------------------------------------------------
  console.log(`\n6) Transferencia con pistola: 20 u. ${ayres.nombre} → ${mercedes.nombre}`);
  const previas = await db.transferencia.count();
  const aMover = { Mango: 8, Uva: 7, Menta: 5 } as const;
  const antes = g;
  const t = await crearYCompletarTransferencia(ctx, {
    depositoOrigenId: ayres.id,
    depositoDestinoId: mercedes.id,
    observacion: "Lo lleva Juan en la camioneta",
    items: Object.entries(aMover).map(([s, cantidad]) => ({ varianteId: id(s), cantidad })),
  });
  const esperado = formatearIdTransferencia("vapes", t.numero);
  check(
    t.codigo === esperado && (previas > 0 || t.codigo === "VAP-T-000001"),
    `código ${t.codigo}${previas === 0 ? " (primera transferencia del panel)" : ` (había ${previas} antes)`}`,
  );
  const doc = await obtenerTransferencia(ctx, t.id);
  check(
    doc.estado === "COMPLETADA" && doc.completadaAt !== null && t.unidades === 20,
    `"Mover ahora": ${doc.estado} en el acto, ${t.unidades} unidades`,
  );
  check(
    doc.items.every(
      (i) => i.productoId === creado.id && i.cantidad === aMover[i.sabor as keyof typeof aMover],
    ),
    "ítems con productoId y la cantidad de cada sabor",
  );
  const movs = await db.movimientoStock.findMany({
    where: { referenciaTipo: "TRANSFERENCIA", referenciaId: t.id },
    select: { tipo: true, varianteId: true, depositoId: true, cantidad: true },
  });
  const parOk = Object.entries(aMover).every(([s, c]) => {
    const salida = movs.filter(
      (m) => m.varianteId === id(s) && m.tipo === TipoMovimiento.TRANSFERENCIA_SALIDA,
    );
    const entrada = movs.filter(
      (m) => m.varianteId === id(s) && m.tipo === TipoMovimiento.TRANSFERENCIA_ENTRADA,
    );
    return (
      salida.length === 1 &&
      entrada.length === 1 &&
      salida[0]!.depositoId === ayres.id &&
      entrada[0]!.depositoId === mercedes.id &&
      salida[0]!.cantidad === c &&
      entrada[0]!.cantidad === c
    );
  });
  check(
    movs.length === 6 && parOk,
    `${movs.length} movimientos: SALIDA en origen + ENTRADA en destino por sabor`,
  );
  g = await global();
  check(
    g.total === antes.total && g.ayres === antes.ayres - 20 && g.mercedes === antes.mercedes + 20,
    `Global: ${ayres.nombre} ${antes.ayres} → ${g.ayres} | ${mercedes.nombre} ${antes.mercedes} → ${g.mercedes} | Total ${antes.total} → ${g.total} (sin cambio)`,
  );

  // Remito
  check(t.remitoUrl !== null && doc.remitoUrl === t.remitoUrl, `remito guardado: ${t.remitoUrl}`);
  const archivo = t.remitoUrl ? await obtenerStorage().leer(claveDeUrl(t.remitoUrl) ?? "") : null;
  check(
    archivo !== null && Buffer.from(archivo.datos).subarray(0, 5).toString() === "%PDF-",
    `el remito es un PDF (${archivo?.datos.length ?? 0} bytes)`,
  );
  const texto = archivo ? textoDePdf(archivo.datos) : "";
  const lineas = new Set(texto.split("\n").map((l) => l.trim()));
  const faltan = [
    t.codigo,
    "Remito de transferencia",
    ayres.nombre,
    mercedes.nombre,
    MARCA,
    "TX",
    "Pitadas",
    "6000",
    "Mango",
    "Uva",
    "Menta",
    "8",
    "7",
    "5",
    "20",
    "Entrega",
    "Recibe",
    "Lo lleva Juan en la camioneta",
  ].filter((x) => !lineas.has(x));
  check(
    faltan.length === 0,
    faltan.length
      ? `remito: faltan ${faltan.join(", ")}`
      : "remito con código, origen/destino, marca, modelo, pitadas (6000), sabor, cantidad, total 20, observación y firmas Entrega/Recibe",
  );

  // 500 unidades → falla entera
  const movsAntes500 = await db.movimientoStock.count();
  const transfAntes500 = await db.transferencia.count();
  const e500 = await error(() =>
    crearYCompletarTransferencia(ctx, {
      depositoOrigenId: ayres.id,
      depositoDestinoId: mercedes.id,
      observacion: undefined,
      items: [
        { varianteId: id("Mango"), cantidad: 5 },
        { varianteId: id("Uva"), cantidad: 500 },
      ],
    }),
  );
  const g500 = await global();
  check(
    e500 instanceof DomainError &&
      e500.code === "STOCK_INSUFICIENTE" &&
      (await db.movimientoStock.count()) === movsAntes500 &&
      (await db.transferencia.count()) === transfAntes500 &&
      g500.ayres === g.ayres &&
      g500.mercedes === g.mercedes,
    `500 unidades → falla entera, sin documento ni movimientos (ni el sabor que alcanzaba): «${mensaje(e500)}»`,
  );

  // Envío pendiente: no mueve hasta confirmar la recepción.
  const envio = await registrarEnvioTransferencia(ctx, {
    depositoOrigenId: mercedes.id,
    depositoDestinoId: ayres.id,
    observacion: undefined,
    items: [{ varianteId: id("Frutilla"), cantidad: 4 }],
  });
  const gEnvio = await global();
  check(
    (await obtenerTransferencia(ctx, envio.id)).estado === "PENDIENTE" &&
      gEnvio.mercedes === g.mercedes &&
      envio.remitoUrl !== null,
    `"Registrar envío" ${envio.codigo}: PENDIENTE, con remito y sin mover stock`,
  );
  await completarTransferencia(ctx, envio.id);
  const gRecibido = await global();
  check(
    gRecibido.mercedes === g.mercedes - 4 &&
      gRecibido.ayres === g.ayres + 4 &&
      gRecibido.total === g.total,
    `"Confirmar recepción": se movieron 4 Frutilla ${mercedes.nombre} → ${ayres.nombre}`,
  );

  console.log(
    fallos === 0 ? "\nTODAS LAS PRUEBAS PASARON ✅\n" : `\n${fallos} PRUEBA(S) FALLARON ❌\n`,
  );
  process.exitCode = fallos === 0 ? 0 : 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
