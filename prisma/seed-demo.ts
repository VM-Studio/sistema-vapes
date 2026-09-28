/**
 * SEED DEMO — 90 días de operación simulada del panel Vapes (ventas, compras,
 * transferencias, ajustes y clientes) para probar el dashboard y los listados.
 * Separado del seed base (que sigue siendo el mínimo para arrancar). Los
 * paneles Cosmetic y Especiales no se tocan.
 *
 * No inserta filas "a mano": fija el reloj de negocio (src/lib/reloj.ts) en
 * cada momento simulado y llama a los MISMOS servicios que la app (vender,
 * anular, compras, transferencias, ajustes) con `ctx = { panelId: Vapes, usuarioId }`.
 * Así los triggers, la numeración por panel y el ledger se ejercitan de verdad.
 *
 * Uso (sobre una DB con el seed base): pnpm db:seed-demo
 * Si la demo ya está cargada (existe su catálogo en Vapes), no hace nada.
 * Determinístico: PRNG con semilla fija.
 */
import { MedioPago, Modulo, Prisma, RolUsuario, TipoMovimiento } from "@prisma/client";
import bcrypt from "bcryptjs";

import { generarEan13 } from "../src/lib/barcode";
import { prisma } from "../src/lib/db";
import { normalizarPermiso } from "../src/lib/permisos";
import { ahora, fijarReloj } from "../src/lib/reloj";
import { crearClienteSchema } from "../src/lib/validations/cliente";
import { crearProveedorSchema } from "../src/lib/validations/proveedor";
import { borradorVentaSchema, venderSchema } from "../src/lib/validations/venta";
import { diaEn, inicioDia, sumarDias, type DiaISO } from "../src/lib/zona-horaria";
import { dbPara, transaccion, type Ctx } from "../src/server/db/panel-scoped";
import { DomainError } from "../src/server/errors";
import { crearCliente } from "../src/server/services/cliente.service";
import { crearCompra, recibirCompra } from "../src/server/services/compra.service";
import { zonaHorariaNegocio } from "../src/server/services/dashboard.service";
import {
  completarTransferencia,
  crearTransferencia,
  registrarAjuste,
} from "../src/server/services/movimiento.service";
import { actualizarPrecios, generarSku } from "../src/server/services/producto.service";
import { crearProveedor } from "../src/server/services/proveedor.service";
import { registrarMovimiento } from "../src/server/services/stock.service";
import { anularVenta, crearBorrador, vender } from "../src/server/services/venta.service";

/**
 * En producción el seed NO corre (crea usuarios con contraseñas conocidas):
 * solo con ALLOW_SEED=true. El primer dueño se crea con `pnpm crear-owner`.
 */
if (process.env.NODE_ENV === "production" && process.env.ALLOW_SEED !== "true") {
  console.error(
    "✘ seed demo bloqueado en producción (definí ALLOW_SEED=true si de verdad es una base de prueba).",
  );
  process.exit(1);
}

const PANEL = "pnl_vapes";
const db = dbPara(PANEL);
const DIAS = 90;
const DUENO = { puedeEditar: true };
const META = { ip: "127.0.0.1", userAgent: "seed-demo" };
const ctxDe = (u: { id: string }): Ctx => ({ panelId: PANEL, usuarioId: u.id, meta: META });

// -----------------------------------------------------------------------------
// PRNG determinístico (mulberry32)
// -----------------------------------------------------------------------------
let semilla = 20260925;
function azar(): number {
  semilla |= 0;
  semilla = (semilla + 0x6d2b79f5) | 0;
  let t = Math.imul(semilla ^ (semilla >>> 15), 1 | semilla);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const entre = (a: number, b: number) => a + Math.floor(azar() * (b - a + 1));
const elegir = <T>(xs: readonly T[]): T => xs[Math.floor(azar() * xs.length)]!;
function ponderado<T>(xs: readonly { valor: T; peso: number }[]): T {
  const total = xs.reduce((a, x) => a + x.peso, 0);
  let r = azar() * total;
  for (const x of xs) if ((r -= x.peso) <= 0) return x.valor;
  return xs[xs.length - 1]!.valor;
}

// -----------------------------------------------------------------------------
// Catálogo extra (con un sabor que nunca se vende: "sabor muerto")
// -----------------------------------------------------------------------------
interface ProductoDemo {
  nombre: string;
  categoria: string;
  marca: string;
  tieneVariantes: boolean;
  costo: string;
  venta: string;
  minimo: number;
  /** stock: [Ayres Plaza, Mercedes]. */
  sabores: { nombre: string; ean12: string; peso: number; stock: [number, number] }[];
}

const PRODUCTOS_DEMO: ProductoDemo[] = [
  {
    nombre: "Lost Mary MO5000",
    categoria: "Vapes",
    marca: "Lost Mary",
    tieneVariantes: true,
    costo: "8800.00",
    venta: "15500.00",
    minimo: 8,
    sabores: [
      { nombre: "Blue Razz", ean12: "779000400001", peso: 9, stock: [20, 10] },
      { nombre: "Watermelon", ean12: "779000400002", peso: 7, stock: [18, 8] },
      { nombre: "Grape", ean12: "779000400003", peso: 4, stock: [12, 6] },
      { nombre: "Peach Ice", ean12: "779000400004", peso: 3, stock: [10, 4] },
      // Nunca se vende: queda como producto sin movimiento.
      { nombre: "Café Tabaco", ean12: "779000400005", peso: 0, stock: [15, 0] },
    ],
  },
  {
    nombre: "Nasty Salt 30ml",
    categoria: "Líquidos",
    marca: "Nasty Juice",
    tieneVariantes: true,
    costo: "5200.00",
    venta: "9500.00",
    minimo: 5,
    sabores: [
      { nombre: "Bad Blood", ean12: "779000500001", peso: 3, stock: [10, 5] },
      { nombre: "Cushman", ean12: "779000500002", peso: 2, stock: [8, 4] },
      { nombre: "Slow Blow", ean12: "779000500003", peso: 1, stock: [6, 0] },
    ],
  },
  {
    nombre: "Vaporesso XROS 3",
    categoria: "Pods",
    marca: "Vaporesso",
    tieneVariantes: false,
    costo: "18000.00",
    venta: "32000.00",
    minimo: 2,
    sabores: [{ nombre: "Único", ean12: "779000600001", peso: 1, stock: [5, 2] }],
  },
];

/** Popularidad de las variantes del seed base. */
const PESOS_BASE: Record<string, number> = {
  "Ignite V80|Mango Ice": 10,
  "Ignite V80|Strawberry Watermelon": 7,
  "Ignite V80|Blue Razz Ice": 8,
  "Ignite V80|Grape Ice": 4,
  "Elf Bar BC5000|Watermelon Ice": 7,
  "Elf Bar BC5000|Peach Mango": 5,
  "Elf Bar BC5000|Cool Mint": 4,
  "Elf Bar BC5000|Lemon Mint": 2,
  "Cargador USB-C 20W|Único": 3,
  "Parlante Bluetooth Mini|Único": 1,
};

interface VarianteDemo {
  id: string;
  nombre: string;
  peso: number;
}

async function crearCatalogoDemo(ctx: Ctx, g1: string, g2: string) {
  for (const p of PRODUCTOS_DEMO) {
    const categoria = await db.categoria.findUniqueOrThrow({
      where: { panelId_nombre: { panelId: PANEL, nombre: p.categoria } },
    });
    const marca = await db.marca.upsert({
      where: { panelId_nombre: { panelId: PANEL, nombre: p.marca } },
      update: {},
      create: { nombre: p.marca },
    });
    await transaccion(
      ctx,
      async (tx) => {
        const producto = await tx.producto.create({
          data: {
            nombre: p.nombre,
            categoriaId: categoria.id,
            marcaId: marca.id,
            tieneVariantes: p.tieneVariantes,
            descripcion: `${p.nombre} (demo)`,
          },
        });
        for (const s of p.sabores) {
          const variante = await tx.variante.create({
            data: {
              productoId: producto.id,
              nombre: s.nombre,
              sku: await generarSku(tx, PANEL),
              codigoBarras: generarEan13(s.ean12),
              precioCosto: p.costo,
              precioVenta: p.venta,
              stockMinimo: p.minimo,
            },
          });
          for (const [i, dep] of [g1, g2].entries()) {
            const cantidad = s.stock[i] ?? 0;
            if (cantidad > 0) {
              await registrarMovimiento(tx, {
                tipo: TipoMovimiento.INGRESO_MANUAL,
                varianteId: variante.id,
                depositoId: dep,
                cantidad,
                costoUnitario: p.costo,
                motivo: "Stock inicial (demo)",
                usuarioId: ctx.usuarioId,
              });
            }
          }
        }
      },
      { timeout: 60_000 },
    );
  }
}

/** Empleados demo: acceso SOLO a Vapes, con permisos de vendedor. */
async function crearUsuariosDemo() {
  const passwordHash = await bcrypt.hash("Cambiar123!", 12);
  const vendedores = [];
  for (const u of [
    { email: "ana@negocio.com", nombre: "Ana" },
    { email: "lucas@negocio.com", nombre: "Lucas" },
  ]) {
    const usuario = await prisma.usuario.upsert({
      where: { email: u.email },
      update: {},
      create: { ...u, rol: RolUsuario.EMPLEADO, passwordHash, debeCambiarPassword: true },
    });
    await prisma.usuarioPanel.upsert({
      where: { usuarioId_panelId: { usuarioId: usuario.id, panelId: PANEL } },
      update: {},
      create: { usuarioId: usuario.id, panelId: PANEL },
    });
    for (const [modulo, crear] of [
      [Modulo.DASHBOARD, false],
      [Modulo.VENTAS, true],
      [Modulo.STOCK, true],
      [Modulo.PRODUCTOS, false],
      [Modulo.CLIENTES, true],
      [Modulo.COTIZADOR, false],
    ] as const) {
      const { panelId, ...acciones } = normalizarPermiso({
        panelId: PANEL,
        modulo,
        puedeVer: true,
        puedeCrear: crear,
        puedeEditar: false,
        puedeEliminar: false,
      });
      await prisma.permisoUsuario.upsert({
        where: { usuarioId_panelId_modulo: { usuarioId: usuario.id, panelId, modulo } },
        update: {},
        create: { usuarioId: usuario.id, panelId, ...acciones },
      });
    }
    vendedores.push(usuario);
  }
  return vendedores;
}

/** Teléfonos distintos entre sí y del cliente del seed base (+541155550101). */
const CLIENTES_DEMO = [
  { nombre: "Sofía", apellido: "Ramírez", documento: "35111222", telefono: "11 5555-0201" },
  { nombre: "Julián", apellido: "Pereyra", documento: "33222333", telefono: "11 5555-0202" },
  { nombre: "Camila", apellido: "Torres", documento: "38333444", telefono: "11 5555-0203" },
  { nombre: "Kiosco El Paso", documento: "30712222334", telefono: "0351 455-0204" },
  { nombre: "Matías", apellido: "Luna", documento: "36444555", telefono: "+54 9 11 5555-0205" },
  { nombre: "Valentina", apellido: "Sosa", documento: "39555666", telefono: "11 5555-0206" },
];

const PROVEEDORES_DEMO = [
  { nombre: "Importadora Vapor Sur SA", cuit: "30716543214", telefono: "+541144440001" },
  { nombre: "TechPro Mayorista", cuit: "30709876542", telefono: "+541144440002" },
];

const MEDIOS = [
  { valor: MedioPago.EFECTIVO, peso: 45 },
  { valor: MedioPago.TRANSFERENCIA, peso: 22 },
  { valor: MedioPago.MERCADOPAGO, peso: 14 },
  { valor: MedioPago.DEBITO, peso: 12 },
  { valor: MedioPago.CREDITO, peso: 7 },
] as const;

// -----------------------------------------------------------------------------
// Simulación
// -----------------------------------------------------------------------------

type Evento = { momento: Date; orden: number; hacer: () => Promise<void> };

async function main() {
  if (await db.producto.findFirst({ where: { nombre: PRODUCTOS_DEMO[0]!.nombre } })) {
    console.log(
      "seed-demo ya se corrió en esta base (el catálogo demo existe en Vapes): no hago nada.",
    );
    return;
  }

  const [owner, owner2] = await prisma.usuario.findMany({
    where: { rol: RolUsuario.OWNER, deletedAt: null },
    orderBy: { createdAt: "asc" },
  });
  const g1 = await db.deposito.findUnique({
    where: { panelId_nombre: { panelId: PANEL, nombre: "Ayres Plaza" } },
  });
  const g2 = await db.deposito.findUnique({
    where: { panelId_nombre: { panelId: PANEL, nombre: "Mercedes" } },
  });
  if (!owner || !owner2 || !g1 || !g2)
    throw new Error("Corré primero el seed base (pnpm db:seed).");
  // Empleados del seed base con acceso a Vapes (Trinidad) también venden.
  const empleadosBase = await prisma.usuario.findMany({
    where: { rol: RolUsuario.EMPLEADO, deletedAt: null, paneles: { some: { panelId: PANEL } } },
    orderBy: { createdAt: "asc" },
    take: 1,
  });

  const ctxOwner = ctxDe(owner);
  const tz = await zonaHorariaNegocio(ctxOwner);
  const ahoraReal = new Date();
  const hoy = diaEn(ahoraReal, tz);
  const primerDia = sumarDias(hoy, -(DIAS - 1));
  const en = (dia: DiaISO, hh: number, mm = 0) =>
    new Date(inicioDia(dia, tz).getTime() + (hh * 60 + mm) * 60_000);

  // El catálogo, los clientes y el stock inicial "existen" desde antes del primer día.
  fijarReloj(() => en(sumarDias(primerDia, -1), 10));
  await crearCatalogoDemo(ctxOwner, g1.id, g2.id);
  const [ana, lucas] = await crearUsuariosDemo();
  const clientes: { id: string }[] = [];
  for (const c of CLIENTES_DEMO) {
    const datos = crearClienteSchema.parse(c);
    const existe = await db.cliente.findFirst({
      where: { documento: datos.documento, deletedAt: null },
    });
    clientes.push(existe ?? (await crearCliente(ctxOwner, datos)));
  }
  const proveedores: { id: string }[] = [
    await db.proveedor.findFirstOrThrow({ where: { deletedAt: null } }),
  ];
  for (const p of PROVEEDORES_DEMO) {
    const datos = crearProveedorSchema.parse(p);
    const existe = await db.proveedor.findFirst({ where: { cuit: datos.cuit, deletedAt: null } });
    proveedores.push(existe ?? (await crearProveedor(ctxOwner, datos)));
  }

  const variantes: VarianteDemo[] = (
    await db.variante.findMany({
      where: { deletedAt: null },
      include: { producto: { select: { nombre: true } } },
    })
  ).map((v) => {
    const clave = `${v.producto.nombre}|${v.nombre}`;
    const demo = PRODUCTOS_DEMO.find((p) => p.nombre === v.producto.nombre)?.sabores.find(
      (s) => s.nombre === v.nombre,
    );
    return { id: v.id, nombre: clave, peso: demo?.peso ?? PESOS_BASE[clave] ?? 1 };
  });
  const vendibles = variantes.filter((v) => v.peso > 0);

  const cajeros: Record<string, { id: string }[]> = {
    [g1.id]: [owner, ana!, ...empleadosBase],
    [g2.id]: [lucas!, owner2],
  };

  const stats = { ventas: 0, anuladas: 0, compras: 0, transferencias: 0, ajustes: 0, fallidas: 0 };
  const agenda = new Map<DiaISO, Evento[]>();
  const esDomingo = (dia: DiaISO) => new Date(`${dia}T12:00:00Z`).getUTCDay() === 0;
  const agendar = (dia: DiaISO, momento: Date, hacer: () => Promise<void>, orden = 5) => {
    // Los domingos está cerrado: lo que caía ese día pasa al lunes.
    if (esDomingo(dia) && dia !== hoy) {
      dia = sumarDias(dia, 1);
      momento = new Date(momento.getTime() + 24 * 3600_000);
    }
    if (dia > hoy || momento > ahoraReal) return;
    const lista = agenda.get(dia) ?? [];
    lista.push({ momento, orden, hacer });
    agenda.set(dia, lista);
  };
  const stockEn = async (varianteId: string, depositoId: string) =>
    (
      await db.stock.findUnique({
        where: { panelId_varianteId_depositoId: { panelId: PANEL, varianteId, depositoId } },
      })
    )?.cantidad ?? 0;

  // --- Ventas: se cobran completas en el momento con un único medio de pago ------
  async function unaVenta(depositoId: string) {
    const cajero = elegir(cajeros[depositoId]!);
    const lineas = new Map<string, number>();
    const n = ponderado([
      { valor: 1, peso: 6 },
      { valor: 2, peso: 3 },
      { valor: 3, peso: 1 },
    ]);
    for (let i = 0; i < n; i++) {
      const v = ponderado(vendibles.map((x) => ({ valor: x, peso: x.peso })));
      const cant = ponderado([
        { valor: 1, peso: 7 },
        { valor: 2, peso: 2 },
        { valor: 3, peso: 1 },
      ]);
      const disponible = (await stockEn(v.id, depositoId)) - (lineas.get(v.id) ?? 0);
      if (disponible >= cant) lineas.set(v.id, (lineas.get(v.id) ?? 0) + cant);
    }
    if (lineas.size === 0) return;
    const cliente = azar() < 0.25 ? elegir(clientes) : null;
    const medioPago = ponderado(MEDIOS);
    const datos = venderSchema.parse({
      venta: {
        depositoId,
        clienteId: cliente?.id,
        items: [...lineas].map(([varianteId, cantidad]) => ({ varianteId, cantidad })),
      },
      medioPago,
      // En efectivo, a veces se redondea a favor del cliente.
      redondearA: medioPago === MedioPago.EFECTIVO && azar() < 0.3 ? 100 : 0,
    });
    try {
      const v = await vender(ctxDe(cajero), datos, DUENO);
      stats.ventas++;
      // ~3%: se anula en el momento (error de carga); la mercadería vuelve al depósito.
      if (azar() < 0.03) {
        await anularVenta(ctxOwner, v.id, "Error de carga: se cobró dos veces");
        stats.anuladas++;
      }
    } catch (e) {
      if (!(e instanceof DomainError)) throw e;
      stats.fallidas++;
    }
  }

  // --- Compras: reponer lo que está bajo ----------------------------------------
  async function unaCompra(depositoId: string) {
    const objetivo = depositoId === g1!.id ? 30 : 15;
    // Estos dos el importador no los trae más: van a quedar bajo mínimo / sin stock.
    const discontinuados = ["Ignite V80|Grape Ice", "Elf Bar BC5000|Lemon Mint"];
    const stocks = await Promise.all(
      vendibles
        .filter((v) => !discontinuados.includes(v.nombre))
        .map(async (v) => ({ v, s: await stockEn(v.id, depositoId) })),
    );
    // Lo que está por debajo de la mitad del objetivo; si no hay, los 3 más bajos.
    let reponer = stocks.filter((x) => x.s < objetivo * 0.5);
    if (reponer.length === 0) reponer = stocks.sort((a, b) => a.s - b.s).slice(0, 3);
    const items = [];
    for (const { v, s } of reponer) {
      const costo = (await db.variante.findUniqueOrThrow({ where: { id: v.id } })).precioCosto;
      items.push({
        varianteId: v.id,
        cantidad: Math.max(objetivo - s, 6),
        costoUnitario: costo.toNumber(),
      });
    }
    const c = await crearCompra(ctxOwner, {
      proveedorId: elegir(proveedores).id,
      depositoId,
      fecha: ahora(),
      descuento: 0,
      notas: undefined,
      items,
    });
    await recibirCompra(ctxOwner, c.id, { actualizarCostos: false });
    stats.compras++;
  }

  let precioActualizado = false;

  for (let i = 0; i < DIAS; i++) {
    const dia = sumarDias(primerDia, i);
    const esHoy = dia === hoy;
    const dow = new Date(`${dia}T12:00:00Z`).getUTCDay(); // 0 domingo
    const abierto = dow !== 0 || esHoy; // los domingos está cerrado

    // Aumento de lista del importador a mitad del período.
    if (!precioActualizado && i >= DIAS / 2) {
      fijarReloj(() => en(dia, 8, 30));
      const ignite = variantes.filter((v) => v.nombre.startsWith("Ignite V80|")).map((v) => v.id);
      await actualizarPrecios(
        ctxOwner,
        ignite,
        { precioCosto: 10200, precioVenta: 17500 },
        "Aumento del importador",
      );
      precioActualizado = true;
    }

    // Ventas del día: más los viernes y sábados.
    const cantidad = !abierto
      ? 0
      : Math.max(0, Math.round((dow === 5 || dow === 6 ? 3.8 : 2.4) + (azar() - 0.5) * 3));
    for (let k = 0; k < cantidad; k++) {
      const hh = ponderado([
        { valor: entre(10, 12), peso: 3 },
        { valor: entre(13, 16), peso: 3 },
        { valor: entre(17, 20), peso: 5 },
      ]);
      const dep = esHoy || azar() < 0.65 ? g1 : g2;
      agendar(dia, en(dia, hh, entre(0, 59)), () => unaVenta(dep.id));
    }
    // Compras cada ~4 días, alternando depósitos.
    if (i % 4 === 2) {
      const dep = (i / 4) % 2 < 1 ? g1 : g2;
      agendar(dia, en(dia, 9, 30), () => unaCompra(dep.id), 1);
    }
    // Ajustes de inventario: roturas y faltantes.
    if ([15, 38, 52, 66, 80].includes(i)) {
      agendar(dia, en(dia, 20, 30), async () => {
        const v = elegir(vendibles);
        const dep = i === 52 ? g2 : g1;
        const s = await stockEn(v.id, dep.id);
        if (s < 2) return;
        await registrarAjuste(ctxDe(i === 52 ? lucas! : ana!), {
          depositoId: dep.id,
          varianteId: v.id,
          cantidadReal: i === 66 ? s + 1 : s - entre(1, 2),
          motivo: i === 66 ? "Apareció en el recuento" : "Faltante en recuento semanal",
        });
        stats.ajustes++;
      });
    }
    // Transferencias: una completada hace dos meses, una pendiente hace 3 días y otra de hoy.
    if (i === 25 || i === DIAS - 4 || esHoy) {
      agendar(
        dia,
        en(dia, 9, 45),
        async () => {
          const v = vendibles.find((x) => x.nombre === "Ignite V80|Mango Ice")!;
          if ((await stockEn(v.id, g1.id)) < 6) return;
          const t = await crearTransferencia(ctxOwner, {
            depositoOrigenId: g1.id,
            depositoDestinoId: g2.id,
            fecha: ahora(),
            notas: "Reposición Mercedes",
            items: [{ varianteId: v.id, cantidad: 4 }],
          });
          if (i === 25) await completarTransferencia(ctxDe(lucas!), t.id);
          stats.transferencias++;
        },
        2,
      );
    }

    // Ejecutar el día en orden cronológico.
    const eventos = (agenda.get(dia) ?? []).sort(
      (a, b) => a.momento.getTime() - b.momento.getTime() || a.orden - b.orden,
    );
    for (const ev of eventos) {
      fijarReloj(() => ev.momento);
      await ev.hacer();
    }
    agenda.delete(dia);
  }

  // Pendientes para el dashboard: dos borradores de venta y una compra sin recibir.
  fijarReloj(() => new Date(ahoraReal.getTime() - 20 * 60_000));
  for (const v of vendibles.slice(0, 2)) {
    await crearBorrador(
      ctxDe(ana!),
      borradorVentaSchema.parse({
        depositoId: g1.id,
        items: [{ varianteId: v.id, cantidad: 1 }],
        notas: "Presupuesto (demo)",
      }),
      DUENO,
    );
  }
  await crearCompra(ctxOwner, {
    proveedorId: proveedores[1]!.id,
    depositoId: g1.id,
    descuento: 0,
    items: [{ varianteId: vendibles[0]!.id, cantidad: 10, costoUnitario: 9000 }],
    notas: "Pedido a confirmar (demo)",
  });
  fijarReloj(null);

  const [ventas, total] = await Promise.all([
    db.venta.groupBy({ by: ["estado"], _count: true }),
    db.venta.aggregate({ where: { estado: "CONFIRMADA" }, _sum: { total: true } }),
  ]);
  console.log("seed-demo OK (panel Vapes)", {
    ...stats,
    ventasPorEstado: Object.fromEntries(ventas.map((v) => [v.estado, v._count])),
    facturado: (total._sum.total ?? new Prisma.Decimal(0)).toString(),
    desde: primerDia,
    hasta: hoy,
  });
}

main()
  .catch((e: unknown) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => {
    fijarReloj(null);
    return prisma.$disconnect();
  });
